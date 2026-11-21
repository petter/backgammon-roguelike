import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameEvent } from "../src/core/game.ts";
import type { OpponentPresence, ServerMessage } from "../src/net/protocol.ts";
import {
  type ClientSocket,
  createRemoteSession,
  HANDOVER_MS,
  PING_MS,
  PONG_GRACE_MS,
  RETIRE_MAX_MS,
  ROTATE_MS,
} from "../src/net/remoteSession.ts";
import type { SessionStatus, SessionUpdate } from "../src/net/session.ts";

/** A socket the test plays the server's side of. */
class FakeSocket implements ClientSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Array<Record<string, unknown>> = [];
  open = true;
  /** A healthy server answers every ping; switch off to play a dead connection. */
  answersPings = true;
  /** A half-dead connection: asked to close, it never reports that it has. */
  lingers = false;

  send(text: string): void {
    if (!this.open) throw new Error("send on a closed socket");
    const message = JSON.parse(text) as Record<string, unknown>;
    this.sent.push(message);
    if (message.type === "ping" && this.answersPings) this.deliver({ type: "pong" });
  }
  close(): void {
    if (this.lingers) this.open = false;
    else this.end();
  }
  /** The connection goes away, whoever ended it. */
  end(): void {
    if (!this.open) return;
    this.open = false;
    this.onclose?.();
  }
  accept(): void {
    this.onopen?.();
  }
  deliver(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  /** Accepts the connection and answers hello with the state at `version`. */
  come(version: number): void {
    this.accept();
    this.deliver(state(version));
  }
  commands(): unknown[] {
    return this.sent.filter((m) => m.type === "command").map((m) => m.command);
  }
  /** The ids of the commands sent on this socket, in order. */
  ids(): number[] {
    return this.sent.filter((m) => m.type === "command").map((m) => m.id as number);
  }
  /** The server acknowledges every command sent on this socket so far. */
  acknowledge(): void {
    for (const id of this.ids()) this.deliver({ type: "done", id });
  }
}

function state(
  version: number,
  events: GameEvent[] = [],
  presence?: OpponentPresence,
): ServerMessage {
  return {
    type: "state",
    version,
    lobby: {
      code: "AAAAA",
      you: "white",
      players: { white: { name: "Ada", character: "seer" }, black: null },
    },
    view: null,
    events,
    ...(presence ? { presence } : {}),
  };
}

const WON: GameEvent[] = [{ type: "gameWon", winner: "white" }];

function session() {
  const sockets: FakeSocket[] = [];
  const statuses: SessionStatus[] = [];
  const updates: SessionUpdate[] = [];
  const presences: Array<OpponentPresence | null> = [];
  const errors: Array<[string, boolean]> = [];
  const api = createRemoteSession(
    "AAAAA",
    "token",
    {
      onStatus: (s) => statuses.push(s),
      onUpdate: (u) => updates.push(u),
      onPresence: (p) => presences.push(p),
      onError: (message, fatal) => errors.push([message, fatal]),
    },
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  );
  return { api, sockets, statuses, updates, presences, errors };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("remote session", () => {
  it("says hello, then is connected once the state arrives", () => {
    const { sockets, statuses, updates } = session();
    expect(statuses).toEqual(["connecting"]);
    sockets[0]!.accept();
    expect(sockets[0]!.sent).toEqual([{ type: "hello", token: "token", presence: true }]);
    sockets[0]!.deliver(state(0));
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(updates).toHaveLength(1);
  });

  it("replaces its socket before the host's limit, without the player noticing", () => {
    const { api, sockets, statuses, updates } = session();
    sockets[0]!.come(4);
    vi.advanceTimersByTime(ROTATE_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    // A second socket is opened while the first is still in use.
    expect(sockets).toHaveLength(2);
    expect(sockets[0]!.open).toBe(true);
    api.send({ type: "roll" });
    expect(sockets[0]!.commands()).toEqual([{ type: "roll" }]);

    sockets[1]!.accept();
    expect(sockets[0]!.open).toBe(true);
    sockets[1]!.deliver(state(4));
    // Commands move to the new one at once. The old one is kept a little longer, to hear
    // the answers to what was sent on it, and only then let go.
    api.send({ type: "endTurn" });
    expect(sockets[1]!.commands()).toEqual([{ type: "endTurn" }]);
    expect(sockets[0]!.commands()).toEqual([{ type: "roll" }]);
    // The old one still owes an answer to the roll, so it is kept until that arrives.
    expect(sockets[0]!.open).toBe(true);
    sockets[0]!.acknowledge();
    expect(sockets[0]!.open).toBe(false);
    // Never offline, and the repeated state is not applied twice.
    expect(statuses.filter((s) => s === "reconnecting")).toEqual([]);
    expect(updates).toHaveLength(1);
  });

  it("keeps replacing, socket after socket", () => {
    const { sockets, statuses } = session();
    sockets[0]!.come(1);
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(ROTATE_MS);
      expect(sockets).toHaveLength(i + 1);
      sockets[i]!.come(1);
      expect(sockets[i]!.open).toBe(true);
      // Nothing was outstanding on the old one, so it goes at once.
      expect(sockets[i - 1]!.open).toBe(false);
      // Never more than the one in use once the old one has been retired.
      expect(sockets.filter((socket) => socket.open)).toHaveLength(1);
    }
    expect(statuses.filter((s) => s !== "connected")).toEqual(["connecting"]);
  });

  it("applies an update that arrives on either socket during a changeover exactly once", () => {
    const { sockets, updates } = session();
    sockets[0]!.come(4);
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1]!.accept();
    // The old socket hears of version 5 first, then the new one starts at 5 and both hear 6.
    sockets[0]!.deliver(state(5));
    sockets[1]!.deliver(state(5));
    sockets[1]!.deliver(state(6));
    expect(updates.map((u) => u.events.length)).toEqual([0, 0, 0]);
    expect(updates).toHaveLength(3);
  });

  it("carries on with the socket in use when a replacement fails, and tries again", () => {
    const { api, sockets, statuses } = session();
    sockets[0]!.come(1);
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1]!.end();
    expect(sockets[0]!.open).toBe(true);
    api.send({ type: "roll" });
    expect(sockets[0]!.commands()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    sockets[2]!.come(1);
    expect(sockets[0]!.open).toBe(true);
    sockets[0]!.acknowledge();
    expect(sockets[0]!.open).toBe(false);
    expect(statuses.filter((s) => s === "reconnecting")).toEqual([]);
  });

  it("is not ended by an error on a replacement while the socket in use works", () => {
    const { api, sockets, statuses, errors } = session();
    sockets[0]!.come(2);
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1]!.accept();
    sockets[1]!.deliver({
      type: "error",
      message: "Something went wrong on the server",
      fatal: true,
    });
    // The replacement is dropped; the game carries on and nothing is reported.
    expect(sockets[1]!.open).toBe(false);
    expect(sockets[0]!.open).toBe(true);
    expect(errors).toEqual([]);
    expect(statuses.at(-1)).toBe("connected");
    api.send({ type: "roll" });
    expect(sockets[0]!.commands()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    sockets[2]!.come(2);
    api.send({ type: "endTurn" });
    expect(sockets[2]!.commands()).toHaveLength(1);
  });

  it("gives every command its own id", () => {
    const { api, sockets } = session();
    sockets[0]!.come(1);
    api.send({ type: "roll" });
    api.send({ type: "endTurn" });
    api.send({ type: "roll" });
    expect(new Set(sockets[0]!.ids()).size).toBe(3);
    expect(sockets[0]!.ids().every((id) => Number.isSafeInteger(id) && id >= 0)).toBe(true);
  });

  it("still hears the answer to a command sent just before a changeover, however late", () => {
    const { api, sockets, updates, errors } = session();
    sockets[0]!.come(4);
    vi.advanceTimersByTime(ROTATE_MS);
    api.send({ type: "pickCard", index: 0 });
    api.send({ type: "playCard", index: 3 });
    sockets[1]!.come(4);
    // The server is slow: well past any short grace period, the old socket is still there.
    vi.advanceTimersByTime(RETIRE_MAX_MS - 1000);
    expect(sockets[0]!.open).toBe(true);
    const [first = -1, second = -1] = sockets[0]!.ids();
    sockets[0]!.deliver(state(5, WON));
    sockets[0]!.deliver({ type: "done", id: first });
    expect(updates.at(-1)?.events).toHaveLength(1);
    // One answer is still owed.
    expect(sockets[0]!.open).toBe(true);
    sockets[0]!.deliver({ type: "error", message: "No such card in hand", fatal: false });
    sockets[0]!.deliver({ type: "done", id: second });
    expect(errors).toEqual([["No such card in hand", false]]);
    // Everything sent on it has been answered: now it goes.
    expect(sockets[0]!.open).toBe(false);
    // The same update on the new socket is not applied a second time.
    sockets[1]!.deliver(state(5, WON));
    expect(updates).toHaveLength(2);
  });

  it("tells the player if a replaced socket never answers, and lets it go", () => {
    const { api, sockets, errors } = session();
    sockets[0]!.come(4);
    vi.advanceTimersByTime(ROTATE_MS);
    api.send({ type: "roll" });
    sockets[1]!.come(4);
    vi.advanceTimersByTime(RETIRE_MAX_MS);
    expect(sockets[0]!.open).toBe(false);
    expect(errors).toEqual([
      ["The server did not answer your last action. Check the board.", false],
    ]);
    // Only once.
    vi.advanceTimersByTime(RETIRE_MAX_MS * 2);
    expect(errors).toHaveLength(1);
  });

  it("tells the player, once, if a replaced socket is lost while it still owes an answer", () => {
    const { api, sockets, errors, statuses } = session();
    sockets[0]!.come(4);
    vi.advanceTimersByTime(ROTATE_MS);
    api.send({ type: "roll" });
    sockets[1]!.come(4);
    // The old socket goes away before answering. The new one is fine, so no banner.
    sockets[0]!.end();
    expect(errors).toEqual([
      ["The server did not answer your last action. Check the board.", false],
    ]);
    expect(statuses.at(-1)).toBe("connected");
    vi.advanceTimersByTime(RETIRE_MAX_MS * 2);
    expect(errors).toHaveLength(1);
  });

  it("says nothing when a replaced socket is lost with nothing outstanding", () => {
    const { api, sockets, errors } = session();
    sockets[0]!.come(4);
    vi.advanceTimersByTime(ROTATE_MS);
    api.send({ type: "roll" });
    api.send({ type: "endTurn" });
    sockets[1]!.come(4);
    const [first = -1, second = -1] = sockets[0]!.ids();
    sockets[0]!.deliver({ type: "done", id: first });
    sockets[0]!.deliver({ type: "done", id: second });
    // Already let go, with everything answered.
    expect(sockets[0]!.open).toBe(false);
    vi.advanceTimersByTime(RETIRE_MAX_MS * 2);
    expect(errors).toEqual([]);
  });

  it("says nothing about unanswered actions when the session itself is closed", () => {
    const { api, sockets, errors } = session();
    sockets[0]!.come(4);
    vi.advanceTimersByTime(ROTATE_MS);
    api.send({ type: "roll" });
    sockets[1]!.come(4);
    api.close();
    vi.advanceTimersByTime(RETIRE_MAX_MS * 2);
    expect(errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not hold a socket open for an acknowledgement of someone else's id", () => {
    const { api, sockets } = session();
    sockets[0]!.come(4);
    vi.advanceTimersByTime(ROTATE_MS);
    api.send({ type: "roll" });
    sockets[1]!.come(4);
    sockets[0]!.deliver({ type: "done", id: 9999 });
    expect(sockets[0]!.open).toBe(true);
    sockets[0]!.acknowledge();
    expect(sockets[0]!.open).toBe(false);
  });

  it("keeps quiet about a replacement that fails without being fatal", () => {
    const { api, sockets, errors, statuses } = session();
    sockets[0]!.come(2);
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1]!.accept();
    sockets[1]!.deliver({
      type: "error",
      message: "Something went wrong on the server",
      fatal: false,
    });
    // Nothing the player did failed, so nothing is said; the replacement is tried again.
    expect(errors).toEqual([]);
    expect(statuses.at(-1)).toBe("connected");
    expect(sockets[1]!.open).toBe(false);
    api.send({ type: "roll" });
    expect(sockets[0]!.commands()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it("keeps quiet about a failed reconnection attempt too, beyond the banner", () => {
    const { sockets, errors, statuses } = session();
    sockets[0]!.come(2);
    sockets[0]!.end();
    vi.advanceTimersByTime(1);
    sockets[1]!.accept();
    sockets[1]!.deliver({
      type: "error",
      message: "Something went wrong on the server",
      fatal: false,
    });
    expect(errors).toEqual([]);
    expect(statuses.at(-1)).toBe("reconnecting");
    vi.advanceTimersByTime(5000);
    expect(sockets.length).toBeGreaterThan(2);
  });

  it("still ends when the only socket is told the seat is gone", () => {
    const { sockets, errors } = session();
    sockets[0]!.come(2);
    sockets[0]!.end();
    vi.advanceTimersByTime(1);
    sockets[1]!.accept();
    sockets[1]!.deliver({ type: "error", message: "That game no longer exists", fatal: true });
    expect(errors).toEqual([["That game no longer exists", true]]);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });

  it("ignores a fatal error on a socket that has already been replaced", () => {
    const { sockets, errors, statuses } = session();
    sockets[0]!.come(1);
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1]!.come(1);
    sockets[0]!.deliver({ type: "error", message: "Already connected", fatal: true });
    expect(errors).toEqual([]);
    expect(sockets[1]!.open).toBe(true);
    expect(statuses.at(-1)).toBe("connected");
  });

  it("acts on a dead connection at once, even if the socket never reports closing", () => {
    const { api, sockets, statuses, errors } = session();
    sockets[0]!.come(1);
    sockets[0]!.answersPings = false;
    sockets[0]!.lingers = true;
    vi.advanceTimersByTime(PING_MS + PONG_GRACE_MS);
    // No close event ever comes, yet the player is told and a new socket is on its way.
    expect(statuses.at(-1)).toBe("reconnecting");
    api.send({ type: "roll" });
    expect(errors).toEqual([["You are offline. Reconnecting…", false]]);
    expect(sockets[0]!.commands()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1]!.come(1);
    expect(statuses.at(-1)).toBe("connected");
  });

  it("says it is reconnecting when the very first connection keeps failing", () => {
    const { sockets, statuses } = session();
    expect(statuses).toEqual(["connecting"]);
    sockets[0]!.end();
    expect(statuses.at(-1)).toBe("reconnecting");
    vi.advanceTimersByTime(1);
    sockets[1]!.end();
    vi.advanceTimersByTime(5000);
    expect(statuses.filter((s) => s === "connecting")).toHaveLength(1);
    expect(statuses.at(-1)).toBe("reconnecting");
    sockets.at(-1)?.come(0);
    expect(statuses.at(-1)).toBe("connected");
  });

  it("abandons a replacement that never answers and tries another", () => {
    const { sockets } = session();
    sockets[0]!.come(1);
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1]!.accept();
    vi.advanceTimersByTime(HANDOVER_MS);
    expect(sockets[1]!.open).toBe(false);
    expect(sockets[0]!.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it("says so at once when the socket in use is lost, and reconnects immediately", () => {
    const { api, sockets, statuses, errors } = session();
    sockets[0]!.come(3);
    sockets[0]!.end();
    expect(statuses.at(-1)).toBe("reconnecting");
    api.send({ type: "roll" });
    expect(errors).toEqual([["You are offline. Reconnecting…", false]]);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1]!.come(5);
    expect(statuses.at(-1)).toBe("connected");
  });

  it("drops the events of an update when versions were skipped while away", () => {
    const { sockets, updates } = session();
    sockets[0]!.come(3);
    sockets[0]!.end();
    vi.advanceTimersByTime(1);
    sockets[1]!.accept();
    sockets[1]!.deliver(state(5, WON));
    expect(updates.at(-1)?.events).toEqual([]);
    sockets[1]!.deliver(state(6, WON));
    expect(updates.at(-1)?.events).toHaveLength(1);
  });

  it("waits longer between attempts while the server stays away", () => {
    const { sockets } = session();
    sockets[0]!.come(1);
    sockets[0]!.end();
    const gaps: number[] = [];
    for (let i = 1; i <= 6; i++) {
      let waited = 0;
      while (sockets.length === i) {
        vi.advanceTimersByTime(50);
        waited += 50;
        if (waited > 20_000) throw new Error("never retried");
      }
      gaps.push(waited);
      sockets[i]!.end();
    }
    expect(gaps[0]).toBeLessThanOrEqual(50);
    expect(gaps[5]).toBeGreaterThan(gaps[1]!);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5050);
  });

  it("gives up a connection that stops answering pings", () => {
    const { sockets, statuses } = session();
    sockets[0]!.come(1);
    vi.advanceTimersByTime(PING_MS);
    expect(sockets[0]!.sent.at(-1)).toEqual({ type: "ping" });
    vi.advanceTimersByTime(PONG_GRACE_MS + 1);
    expect(sockets[0]!.open).toBe(true);

    // From now on no answer comes. Step to the moment of the next ping, then let its grace run out.
    sockets[0]!.answersPings = false;
    vi.advanceTimersByTime(PING_MS - PONG_GRACE_MS - 1);
    expect(sockets[0]!.sent.filter((m) => m.type === "ping")).toHaveLength(2);
    expect(sockets[0]!.open).toBe(true);
    vi.advanceTimersByTime(PONG_GRACE_MS);
    expect(sockets[0]!.open).toBe(false);
    expect(statuses.at(-1)).toBe("reconnecting");
  });

  it("stops for good on a fatal error", () => {
    const { sockets, errors } = session();
    sockets[0]!.accept();
    sockets[0]!.deliver({ type: "error", message: "That game no longer exists", fatal: true });
    expect(errors).toEqual([["That game no longer exists", true]]);
    expect(sockets[0]!.open).toBe(false);
    vi.advanceTimersByTime(ROTATE_MS * 2);
    expect(sockets).toHaveLength(1);
  });

  it("opens nothing and sends nothing after it is closed", () => {
    const { api, sockets } = session();
    sockets[0]!.come(1);
    vi.advanceTimersByTime(ROTATE_MS);
    api.close();
    expect(sockets.every((s) => !s.open)).toBe(true);
    vi.advanceTimersByTime(ROTATE_MS * 3);
    expect(sockets).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers live presence updates from the active socket and resyncs presence on reconnect", () => {
    const { api, sockets, presences, updates } = session();
    sockets[0]!.accept();
    sockets[0]!.deliver(state(3, [], { online: true, claimInMs: null }));
    sockets[0]!.deliver({ type: "presence", online: false, claimInMs: 30_000 });
    expect(presences).toEqual([
      { online: true, claimInMs: null },
      { online: false, claimInMs: 30_000 },
    ]);

    // While offline, the opponent reconnected without making a move (same version 3).
    sockets[0]!.end();
    vi.advanceTimersByTime(1);
    sockets[1]!.accept();
    sockets[1]!.deliver(state(3, [], { online: true, claimInMs: null }));
    expect(updates).toHaveLength(1);
    expect(presences.at(-1)).toEqual({ online: true, claimInMs: null });

    // Presence messages arriving on a retiring socket after rotation are ignored.
    vi.advanceTimersByTime(ROTATE_MS);
    api.send({ type: "roll" });
    sockets[2]!.accept();
    sockets[2]!.deliver(state(3, [], { online: true, claimInMs: null }));
    const count = presences.length;
    sockets[1]!.deliver({ type: "presence", online: false, claimInMs: 25_000 });
    expect(presences).toHaveLength(count);
  });

  it("delivers state updates before snapshot presence so handlers already see the installed view", () => {
    const sockets: FakeSocket[] = [];
    const order: string[] = [];
    createRemoteSession(
      "AAAAA",
      "token",
      {
        onStatus: () => {},
        onUpdate: () => order.push("update"),
        onPresence: () => order.push("presence"),
        onError: () => {},
      },
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    );
    sockets[0]!.accept();
    sockets[0]!.deliver(state(1, [], { online: false, claimInMs: 12_000 }));
    expect(order).toEqual(["update", "presence"]);
  });

  it("still delivers active-socket presence when a retiring socket delivered that game version first", () => {
    const { api, sockets, presences, updates } = session();
    sockets[0]!.accept();
    sockets[0]!.deliver(state(4, [], { online: false, claimInMs: null }));
    vi.advanceTimersByTime(ROTATE_MS);
    api.send({ type: "rematch" });
    sockets[1]!.accept();
    sockets[1]!.deliver(state(4, [], { online: false, claimInMs: null }));
    const before = presences.length;

    // Retiring socket delivers rematch v5 first (updates view, skips retiring presence).
    sockets[0]!.deliver(state(5, [], { online: false, claimInMs: 30_000 }));
    expect(updates).toHaveLength(2);
    expect(presences).toHaveLength(before);

    // Active socket then delivers v5 with presence: must NOT be skipped!
    sockets[1]!.deliver(state(5, [], { online: false, claimInMs: 30_000 }));
    expect(presences.at(-1)).toEqual({ online: false, claimInMs: 30_000 });
  });

  it("keeps the rematch countdown when a replacement promotes with an older game-over v4 snapshot before catching up to v5", () => {
    const { sockets, presences } = session();
    const baseView = {
      you: "white" as const,
      board: { points: [], bar: { white: 0, black: 0 }, off: { white: 0, black: 0 } },
      current: "white" as const,
      dice: [],
      winner: null,
      winReason: null,
      shielded: { white: false, black: false },
      wins: { white: 1, black: 0 },
      rematch: { white: false, black: false },
      hand: [],
      offer: [],
      counts: {
        white: { hand: 0, deck: 0, discard: 0 },
        black: { hand: 0, deck: 0, discard: 0 },
      },
    };
    const overView = { ...baseView, phase: "over" as const, winner: "white" as const };
    const rematchView = { ...baseView, phase: "pick" as const };
    const lobby = {
      code: "AAAAA",
      you: "white" as const,
      players: {
        white: { name: "Ada", character: "seer" as const },
        black: { name: "Grace", character: "gambler" as const },
      },
    };
    sockets[0]!.accept();
    sockets[0]!.deliver({
      type: "state",
      version: 5,
      lobby,
      view: rematchView,
      events: [],
      presence: { online: false, claimInMs: 30_000 },
    });
    expect(presences).toEqual([{ online: false, claimInMs: 30_000 }]);

    // Rotate: replacement promotes with a slightly stale game-over v4 snapshot, then catches up to v5.
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1]!.accept();
    sockets[1]!.deliver({
      type: "state",
      version: 4,
      lobby,
      view: overView,
      events: [],
      presence: { online: false, claimInMs: null },
    });
    // Must NOT regress presence to v4's `claimInMs: null`.
    expect(presences).toEqual([{ online: false, claimInMs: 30_000 }]);

    // A standalone presence frame emitted while the replacement is still on game-over v4
    // must also be ignored until the replacement catches up to the rematch stage.
    sockets[1]!.deliver({ type: "presence", online: false, claimInMs: null });
    expect(presences).toEqual([{ online: false, claimInMs: 30_000 }]);

    // Replacement catches up to v5 with updated remaining time: must apply on the new socket.
    sockets[1]!.deliver({
      type: "state",
      version: 5,
      lobby,
      view: rematchView,
      events: [],
      presence: { online: false, claimInMs: 28_000 },
    });
    expect(presences.at(-1)).toEqual({ online: false, claimInMs: 28_000 });

    // Once caught up to v5's stage, standalone presence frames on the replacement apply normally.
    sockets[1]!.deliver({ type: "presence", online: true, claimInMs: null });
    expect(presences.at(-1)).toEqual({ online: true, claimInMs: null });
  });

  it("keeps the replacement's initial away presence when the old socket delivered an ordinary move first", () => {
    const { sockets, presences } = session();
    const activeView = (phase: "pick" | "roll") => ({
      you: "white" as const,
      board: { points: [], bar: { white: 0, black: 0 }, off: { white: 0, black: 0 } },
      current: "white" as const,
      dice: [],
      phase,
      winner: null,
      winReason: null,
      shielded: { white: false, black: false },
      wins: { white: 0, black: 0 },
      rematch: { white: false, black: false },
      hand: [],
      offer: [],
      counts: {
        white: { hand: 0, deck: 0, discard: 0 },
        black: { hand: 0, deck: 0, discard: 0 },
      },
    });
    const lobby = {
      code: "AAAAA",
      you: "white" as const,
      players: {
        white: { name: "Ada", character: "seer" as const },
        black: { name: "Grace", character: "gambler" as const },
      },
    };
    sockets[0]!.accept();
    sockets[0]!.deliver({
      type: "state",
      version: 1,
      lobby,
      view: activeView("pick"),
      events: [],
      presence: { online: true, claimInMs: null },
    });
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1]!.accept();

    // Old socket delivers ordinary move v2 (without presence) before replacement's v1 arrives.
    sockets[0]!.deliver({
      type: "state",
      version: 2,
      lobby,
      view: activeView("roll"),
      events: [],
    });

    // Replacement promotes with its initial v1 snapshot carrying the opponent's away state,
    // followed by the ordinary v2 move without presence. The away notification must NOT be dropped.
    sockets[1]!.deliver({
      type: "state",
      version: 1,
      lobby,
      view: activeView("pick"),
      events: [],
      presence: { online: false, claimInMs: 30_000 },
    });
    expect(presences.at(-1)).toEqual({ online: false, claimInMs: 30_000 });

    sockets[1]!.deliver({
      type: "state",
      version: 2,
      lobby,
      view: activeView("roll"),
      events: [],
    });
    expect(presences.at(-1)).toEqual({ online: false, claimInMs: 30_000 });
  });

  it("clears stale claim availability silently when rotating onto an older server whose snapshot omits presence", () => {
    const { sockets, presences } = session();
    const activeView = {
      you: "white" as const,
      board: { points: [], bar: { white: 0, black: 0 }, off: { white: 0, black: 0 } },
      current: "white" as const,
      dice: [],
      phase: "roll" as const,
      winner: null,
      winReason: null,
      shielded: { white: false, black: false },
      wins: { white: 0, black: 0 },
      rematch: { white: false, black: false },
      hand: [],
      offer: [],
      counts: {
        white: { hand: 0, deck: 0, discard: 0 },
        black: { hand: 0, deck: 0, discard: 0 },
      },
    };
    sockets[0]!.accept();
    sockets[0]!.deliver({
      type: "state",
      version: 4,
      lobby: {
        code: "AAAAA",
        you: "white",
        players: {
          white: { name: "Ada", character: "seer" },
          black: { name: "Grace", character: "gambler" },
        },
      },
      view: activeView,
      events: [],
      presence: { online: false, claimInMs: 0 },
    });
    expect(presences.at(-1)).toEqual({ online: false, claimInMs: 0 });

    // Rotate onto an older server that omits `presence` on its state snapshot.
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1]!.accept();
    sockets[1]!.deliver({
      type: "state",
      version: 4,
      lobby: {
        code: "AAAAA",
        you: "white",
        players: {
          white: { name: "Ada", character: "seer" },
          black: { name: "Grace", character: "gambler" },
        },
      },
      view: activeView,
      events: [],
    });
    expect(presences.at(-1)).toBeNull();
  });
});
