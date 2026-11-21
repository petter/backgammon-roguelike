import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameEvent } from "../src/core/game.ts";
import type { ServerMessage } from "../src/net/protocol.ts";
import {
  type ClientSocket,
  createRemoteSession,
  HANDOVER_MS,
  PING_MS,
  PONG_GRACE_MS,
  ROTATE_MS,
} from "../src/net/remoteSession.ts";
import type { SessionStatus, SessionUpdate } from "../src/net/session.ts";

/** A socket the test plays the server's side of. */
class FakeSocket implements ClientSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Record<string, unknown>[] = [];
  open = true;
  /** A healthy server answers every ping; switch off to play a dead connection. */
  answersPings = true;

  send(text: string): void {
    if (!this.open) throw new Error("send on a closed socket");
    const message = JSON.parse(text);
    this.sent.push(message);
    if (message.type === "ping" && this.answersPings) this.deliver({ type: "pong" });
  }
  close(): void {
    this.end();
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
}

function state(version: number, events: GameEvent[] = []): ServerMessage {
  return {
    type: "state",
    version,
    lobby: { code: "AAAAA", you: "white", players: { white: { name: "Ada" }, black: null } },
    view: null,
    events,
  };
}

const WON: GameEvent[] = [{ type: "gameWon", winner: "white" }];

function session() {
  const sockets: FakeSocket[] = [];
  const statuses: SessionStatus[] = [];
  const updates: SessionUpdate[] = [];
  const errors: [string, boolean][] = [];
  const api = createRemoteSession(
    "AAAAA",
    "token",
    {
      onStatus: (s) => statuses.push(s),
      onUpdate: (u) => updates.push(u),
      onError: (message, fatal) => errors.push([message, fatal]),
    },
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  );
  return { api, sockets, statuses, updates, errors };
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
    sockets[0].accept();
    expect(sockets[0].sent).toEqual([{ type: "hello", token: "token" }]);
    sockets[0].deliver(state(0));
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(updates).toHaveLength(1);
  });

  it("replaces its socket before the host's limit, without the player noticing", () => {
    const { api, sockets, statuses, updates } = session();
    sockets[0].come(4);
    vi.advanceTimersByTime(ROTATE_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    // A second socket is opened while the first is still in use.
    expect(sockets).toHaveLength(2);
    expect(sockets[0].open).toBe(true);
    api.send({ type: "roll" });
    expect(sockets[0].commands()).toEqual([{ type: "roll" }]);

    sockets[1].accept();
    expect(sockets[0].open).toBe(true);
    sockets[1].deliver(state(4));
    // Only now is the old one let go, and commands move to the new one.
    expect(sockets[0].open).toBe(false);
    api.send({ type: "endTurn" });
    expect(sockets[1].commands()).toEqual([{ type: "endTurn" }]);
    // Never offline, and the repeated state is not applied twice.
    expect(statuses.filter((s) => s === "reconnecting")).toEqual([]);
    expect(updates).toHaveLength(1);
  });

  it("keeps replacing, socket after socket", () => {
    const { sockets, statuses } = session();
    sockets[0].come(1);
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(ROTATE_MS);
      expect(sockets).toHaveLength(i + 1);
      sockets[i].come(1);
      expect(sockets[i - 1].open).toBe(false);
      expect(sockets[i].open).toBe(true);
    }
    expect(statuses.filter((s) => s !== "connected")).toEqual(["connecting"]);
  });

  it("applies an update that arrives on either socket during a changeover exactly once", () => {
    const { sockets, updates } = session();
    sockets[0].come(4);
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1].accept();
    // The old socket hears of version 5 first, then the new one starts at 5 and both hear 6.
    sockets[0].deliver(state(5));
    sockets[1].deliver(state(5));
    sockets[1].deliver(state(6));
    expect(updates.map((u) => u.events.length)).toEqual([0, 0, 0]);
    expect(updates).toHaveLength(3);
  });

  it("carries on with the socket in use when a replacement fails, and tries again", () => {
    const { api, sockets, statuses } = session();
    sockets[0].come(1);
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1].end();
    expect(sockets[0].open).toBe(true);
    api.send({ type: "roll" });
    expect(sockets[0].commands()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    sockets[2].come(1);
    expect(sockets[0].open).toBe(false);
    expect(statuses.filter((s) => s === "reconnecting")).toEqual([]);
  });

  it("abandons a replacement that never answers and tries another", () => {
    const { sockets } = session();
    sockets[0].come(1);
    vi.advanceTimersByTime(ROTATE_MS);
    sockets[1].accept();
    vi.advanceTimersByTime(HANDOVER_MS);
    expect(sockets[1].open).toBe(false);
    expect(sockets[0].open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it("says so at once when the socket in use is lost, and reconnects immediately", () => {
    const { api, sockets, statuses, errors } = session();
    sockets[0].come(3);
    sockets[0].end();
    expect(statuses.at(-1)).toBe("reconnecting");
    api.send({ type: "roll" });
    expect(errors).toEqual([["You are offline. Reconnecting…", false]]);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].come(5);
    expect(statuses.at(-1)).toBe("connected");
  });

  it("drops the events of an update when versions were skipped while away", () => {
    const { sockets, updates } = session();
    sockets[0].come(3);
    sockets[0].end();
    vi.advanceTimersByTime(1);
    sockets[1].accept();
    sockets[1].deliver(state(5, WON));
    expect(updates.at(-1)?.events).toEqual([]);
    sockets[1].deliver(state(6, WON));
    expect(updates.at(-1)?.events).toHaveLength(1);
  });

  it("waits longer between attempts while the server stays away", () => {
    const { sockets } = session();
    sockets[0].come(1);
    sockets[0].end();
    const gaps: number[] = [];
    for (let i = 1; i <= 6; i++) {
      let waited = 0;
      while (sockets.length === i) {
        vi.advanceTimersByTime(50);
        waited += 50;
        if (waited > 20_000) throw new Error("never retried");
      }
      gaps.push(waited);
      sockets[i].end();
    }
    expect(gaps[0]).toBeLessThanOrEqual(50);
    expect(gaps[5]).toBeGreaterThan(gaps[1]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5050);
  });

  it("gives up a connection that stops answering pings", () => {
    const { sockets, statuses } = session();
    sockets[0].come(1);
    vi.advanceTimersByTime(PING_MS);
    expect(sockets[0].sent.at(-1)).toEqual({ type: "ping" });
    vi.advanceTimersByTime(PONG_GRACE_MS + 1);
    expect(sockets[0].open).toBe(true);

    // From now on no answer comes. Step to the moment of the next ping, then let its grace run out.
    sockets[0].answersPings = false;
    vi.advanceTimersByTime(PING_MS - PONG_GRACE_MS - 1);
    expect(sockets[0].sent.filter((m) => m.type === "ping")).toHaveLength(2);
    expect(sockets[0].open).toBe(true);
    vi.advanceTimersByTime(PONG_GRACE_MS);
    expect(sockets[0].open).toBe(false);
    expect(statuses.at(-1)).toBe("reconnecting");
  });

  it("stops for good on a fatal error", () => {
    const { sockets, errors } = session();
    sockets[0].accept();
    sockets[0].deliver({ type: "error", message: "That game no longer exists", fatal: true });
    expect(errors).toEqual([["That game no longer exists", true]]);
    expect(sockets[0].open).toBe(false);
    vi.advanceTimersByTime(ROTATE_MS * 2);
    expect(sockets).toHaveLength(1);
  });

  it("opens nothing and sends nothing after it is closed", () => {
    const { api, sockets } = session();
    sockets[0].come(1);
    vi.advanceTimersByTime(ROTATE_MS);
    api.close();
    expect(sockets.every((s) => !s.open)).toBe(true);
    vi.advanceTimersByTime(ROTATE_MS * 3);
    expect(sockets).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
