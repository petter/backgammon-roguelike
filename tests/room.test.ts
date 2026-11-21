import { describe, expect, it, vi } from "vitest";

import { applyCommand, type Command, canPlayCard, legalMoves, newGame } from "../src/core/game.ts";
import { isRoomCode, type ServerMessage } from "../src/net/protocol.ts";
import { createMemoryStore } from "../src/server/memoryStore.ts";
import {
  ARRIVAL_GRACE_MS,
  CLAIM_GRACE_MS,
  createMatchedRoom,
  createRoom,
  joinRoom,
  openConnection,
  PRESENCE_LEASE_MS,
  RoomError,
} from "../src/server/room.ts";
import type { GameStore, Room } from "../src/server/store.ts";

type State = Extract<ServerMessage, { type: "state" }>;

async function client(store: GameStore, code: string, token: string) {
  const inbox: ServerMessage[] = [];
  const connection = await openConnection(store, code, token, (m) => inbox.push(m));
  return {
    inbox,
    connection,
    send: (command: Command) => connection.command(command),
    last: () => inbox.findLast((m): m is State => m.type === "state") as State,
    errors: () => inbox.flatMap((m) => (m.type === "error" ? [m.message] : [])),
  };
}

/** A started game with both players connected. */
async function table(store: GameStore = createMemoryStore()) {
  const host = await createRoom(store, "Ada");
  const guest = await joinRoom(store, host.code, "Grace");
  const white = await client(store, host.code, host.token);
  const black = await client(store, host.code, guest.token);
  const first = white.last().view?.current === "white" ? white : black;
  const second = first === white ? black : white;
  return { store, code: host.code, host, guest, white, black, first, second };
}

describe("lobby", () => {
  it("creates a room with a well-formed code and a host seat", async () => {
    const store = createMemoryStore();
    const { code, token } = await createRoom(store, "  Ada   Lovelace  ");
    expect(isRoomCode(code)).toBe(true);
    const room = await store.load(code);
    expect(room?.seats.white).toEqual({
      token,
      name: "Ada Lovelace",
      character: "gambler",
      presence: true,
    });
    expect(room?.game).toBeNull();
  });

  it("falls back to a default name and trims long ones", async () => {
    const store = createMemoryStore();
    const a = await createRoom(store, "   ");
    const b = await createRoom(store, "x".repeat(200));
    const c = await createRoom(store, { not: "a string" });
    expect((await store.load(a.code))?.seats.white?.name).toBe("Host");
    expect((await store.load(b.code))?.seats.white?.name).toHaveLength(20);
    expect((await store.load(c.code))?.seats.white?.name).toBe("Host");
  });

  it("keeps a known character and replaces anything else with the default", async () => {
    const store = createMemoryStore();
    const host = await createRoom(store, "Ada", undefined, "seer");
    await joinRoom(store, host.code, "Grace", undefined, "corsair");
    const white = await client(store, host.code, host.token);
    expect(white.last().lobby.players).toEqual({
      white: { name: "Ada", character: "seer" },
      black: { name: "Grace", character: "corsair" },
    });
    for (const junk of ["wizard", "toString", "__proto__", "", 3, null, { id: "seer" }, ["seer"]]) {
      const made = await createRoom(store, "Eve", undefined, junk);
      expect((await store.load(made.code))?.seats.white?.character, JSON.stringify(junk)).toBe(
        "gambler",
      );
    }
  });

  it("gives a seat saved before characters existed the default one", async () => {
    const store = createMemoryStore();
    const host = await createRoom(store, "Ada", undefined, "seer");
    const room = (await store.load(host.code)) as Room;
    const old = { token: host.token, name: "Ada" };
    await store.save({ ...room, version: room.version + 1, seats: { white: old } }, room.version);
    const white = await client(store, host.code, host.token);
    expect(white.last().lobby.players.white).toEqual({ name: "Ada", character: "gambler" });
  });

  it("retries when a generated code is already taken", async () => {
    const store = createMemoryStore();
    const digits = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
    const entropy = { token: () => "tok", int: () => digits.shift() ?? 2 };
    expect((await createRoom(store, "a", entropy)).code).toBe("AAAAA");
    expect((await createRoom(store, "b", entropy)).code).toBe("BBBBB");
  });

  it("shows the host a waiting lobby until the guest joins, then starts the game", async () => {
    const store = createMemoryStore();
    const host = await createRoom(store, "Ada");
    const white = await client(store, host.code, host.token);
    expect(white.last()).toMatchObject({
      version: 0,
      view: null,
      lobby: { code: host.code, you: "white", players: { white: { name: "Ada" }, black: null } },
    });

    await joinRoom(store, host.code, "Grace");
    expect(white.last().version).toBe(1);
    expect(white.last().lobby.players.black).toEqual({ name: "Grace", character: "gambler" });
    expect(white.last().view?.you).toBe("white");
  });

  it("refuses a third player, an unknown code and a wrong token", async () => {
    const { store, code } = await table();
    await expect(joinRoom(store, code, "Eve")).rejects.toMatchObject({ kind: "full" });
    await expect(joinRoom(store, "ZZZZZ", "Eve")).rejects.toMatchObject({ kind: "not_found" });
    await expect(client(store, code, "nope")).rejects.toMatchObject({ kind: "bad_token" });
    await expect(client(store, code, "")).rejects.toBeInstanceOf(RoomError);
    await expect(client(store, "ZZZZZ", "nope")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("gives two players racing for the last seat exactly one of it", async () => {
    const store = createMemoryStore();
    const host = await createRoom(store, "Ada");
    const results = await Promise.allSettled([
      joinRoom(store, host.code, "Grace"),
      joinRoom(store, host.code, "Eve"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.load(host.code))?.version).toBe(1);
  });

  it("never sends a seat token to anyone", async () => {
    const { white, black, host, guest, first } = await table();
    await first.send({ type: "pickCard", index: 0 });
    const wire = JSON.stringify([...white.inbox, ...black.inbox]);
    expect(wire).not.toContain(host.token);
    expect(wire).not.toContain(guest.token);
  });
});

describe("playing", () => {
  it("sends both players each change, with the picked card hidden from the opponent", async () => {
    const { first, second } = await table();
    const offer = first.last().view?.offer ?? [];
    expect(offer).toHaveLength(3);
    expect(second.last().view?.offer).toEqual([]);

    await first.send({ type: "pickCard", index: 2 });
    const mover = first.last().view?.you;
    expect(first.last().events).toEqual([{ type: "cardPicked", player: mover, card: offer[2] }]);
    expect(second.last().events).toEqual([{ type: "cardPicked", player: mover, card: null }]);
    expect(first.last().view?.hand).toEqual([offer[2]]);
    expect(second.last().view?.hand).toEqual([]);
    expect(second.last().view?.counts[mover ?? "white"].hand).toBe(1);
    expect(first.last().version).toBe(second.last().version);
  });

  it("keeps the opponent's cards and the RNG off the wire for a whole game", async () => {
    const { store, code, white, black } = await table();
    for (let step = 0; step < 2000; step++) {
      const mover = white.last().view?.current === "white" ? white : black;
      const mine = mover.last().view;
      if (!mine || mine.phase === "over") break;
      const [move] = legalMoves(mine);
      // Hold a few cards back, so hands are never empty when the wire is inspected.
      const playable = mine.hand.length > 3 ? mine.hand.findIndex((c) => canPlayCard(mine, c)) : -1;
      if (mine.phase === "pick") await mover.send({ type: "pickCard", index: 0 });
      else if (mine.phase === "roll") await mover.send({ type: "roll" });
      else if (move)
        await mover.send({ type: "move", from: move.from, to: move.to, die: move.die });
      else if (playable >= 0) await mover.send({ type: "playCard", index: playable });
      else await mover.send({ type: "endTurn" });
    }
    expect((await store.load(code))?.game?.phase).toBe("over");
    expect(white.last().view?.winner).toBe(black.last().view?.winner);

    for (const { inbox } of [white, black]) {
      for (const message of inbox) {
        if (message.type !== "state") continue;
        const wire = JSON.stringify(message);
        expect(wire).not.toContain('"rng"');
        expect(wire).not.toContain('"deck":[');
        expect(wire).not.toContain('"cards":{');
        for (const event of message.events) {
          if (event.type === "cardsOffered" && event.player !== message.lobby.you) {
            expect(event.cards).toBeNull();
          }
          if (event.type === "cardPicked" && event.player !== message.lobby.you) {
            expect(event.card).toBeNull();
          }
        }
      }
    }
  });

  it("answers a rule violation with an error to the sender only, and changes nothing", async () => {
    const { store, code, first, second } = await table();
    const before = (await store.load(code))?.version;
    const sent = second.inbox.length;

    await second.send({ type: "roll" });
    expect(second.errors()).toEqual(["It is not your turn"]);
    await first.send({ type: "endTurn" });
    expect(first.errors()).toEqual(["Roll before ending your turn"]);
    await first.send({ type: "pickCard", index: 7 });
    expect(first.errors()).toHaveLength(2);

    expect((await store.load(code))?.version).toBe(before);
    expect(second.inbox).toHaveLength(sent + 1);
  });

  it("draws fresh randomness for every command instead of running a stored sequence", async () => {
    const store = createMemoryStore();
    const seeds = [11, 22, 33];
    let next = 500;
    const entropy = { token: () => `t${next}`, int: () => seeds.shift() ?? next++ };
    const host = await createRoom(store, "Ada", { token: () => "host", int: () => 0 });
    const guest = await joinRoom(store, host.code, "Grace", entropy);
    // The three game seeds are independent draws, not one seed stretched three ways.
    expect((await store.load(host.code))?.game).toEqual(
      newGame({ white: 11, black: 22, play: 33 }).state,
    );

    const inbox: ServerMessage[] = [];
    const first = (await store.load(host.code))?.game?.current;
    const token = first === "white" ? host.token : guest.token;
    const mover = await openConnection(store, host.code, token, (m) => inbox.push(m), { entropy });
    await mover.command({ type: "pickCard", index: 0 });
    const before = (await store.load(host.code))?.game;
    await mover.command({ type: "roll" });
    const after = (await store.load(host.code))?.game;
    if (!before || !after || !first) throw new Error("game missing");
    // The roll came from the entropy handed in for that command, not from the stored state.
    const expected = applyCommand({ ...before, rng: 501 }, first, { type: "roll" }).state;
    expect(after.dice).toEqual(expected.dice);
    expect(after.rng).toBe(expected.rng);
  });

  it("refuses commands before the game has started", async () => {
    const store = createMemoryStore();
    const host = await createRoom(store, "Ada");
    const white = await client(store, host.code, host.token);
    await white.send({ type: "roll" });
    expect(white.errors()).toEqual(["The game has not started yet"]);
  });

  it("applies each of two racing commands at most once", async () => {
    const { store, code, first } = await table();
    const before = (await store.load(code))?.version ?? 0;
    await Promise.all([
      first.send({ type: "pickCard", index: 0 }),
      first.send({ type: "pickCard", index: 1 }),
    ]);
    const room = await store.load(code);
    expect(room?.version).toBe(before + 1);
    expect(room?.game?.cards[room.game.current].hand).toHaveLength(1);
    expect(first.errors()).toEqual(["There is no card to pick right now"]);
  });

  it("retries a save that lost the race, without losing the other writer's change", async () => {
    const inner = createMemoryStore();
    let failNext = false;
    const flaky: GameStore = {
      ...inner,
      async save(room, expected) {
        if (failNext) {
          failNext = false;
          // Someone else writes first: bump the version underneath this writer.
          const current = await inner.load(room.code);
          if (current) await inner.save({ ...current, version: current.version + 1 }, expected);
        }
        return inner.save(room, expected);
      },
    };
    const { store, code, first } = await table(flaky);
    const before = (await store.load(code))?.version ?? 0;
    failNext = true;
    await first.send({ type: "pickCard", index: 0 });
    expect(first.errors()).toEqual([]);
    expect((await store.load(code))?.version).toBe(before + 2);
    expect(first.last().view?.hand).toHaveLength(1);
  });

  it("gives up with an error when the room stays contended", async () => {
    const inner = createMemoryStore();
    let block = false;
    const stuck: GameStore = { ...inner, save: async (r, e) => (block ? false : inner.save(r, e)) };
    const { first } = await table(stuck);
    block = true;
    await first.send({ type: "pickCard", index: 0 });
    expect(first.errors()).toEqual(["The game is busy, try again"]);
  });

  it("resyncs a player who reconnects, and stops sending after close", async () => {
    const { store, code, host, guest, white, black, first } = await table();
    const dropped = first === white ? black : white;
    const token = dropped === white ? host.token : guest.token;
    dropped.connection.close();
    const seen = dropped.inbox.length;

    await first.send({ type: "pickCard", index: 0 });
    await first.send({ type: "roll" });
    expect(dropped.inbox).toHaveLength(seen);

    const back = await client(store, code, token);
    expect(back.inbox).toHaveLength(1);
    expect(back.last().events).toEqual([]);
    expect(back.last().version).toBe(first.last().version);
    expect(back.last().view?.dice).toEqual(first.last().view?.dice);
    expect(back.last().view?.phase).toBe("move");
  });

  it("still shows the mover their move when the announcement fails, and commits it once", async () => {
    const inner = createMemoryStore();
    let broken = false;
    const store: GameStore = {
      ...inner,
      publish: async (code, update) => {
        if (broken) throw new Error("NOPERM");
        return inner.publish(code, update);
      },
    };
    const { code, first, second } = await table(store);
    const before = first.last().version;
    broken = true;
    await first.send({ type: "pickCard", index: 0 });

    expect((await store.load(code))?.version).toBe(before + 1);
    expect(first.errors()).toEqual([]);
    expect(first.last().version).toBe(before + 1);
    expect(first.last().view?.hand).toHaveLength(1);
    expect(first.last().events).toHaveLength(1);
    // The other player has not heard yet...
    expect(second.last().version).toBe(before);
  });

  it("catches a player up by itself when an announcement was lost", async () => {
    vi.useFakeTimers();
    try {
      const inner = createMemoryStore();
      let broken = false;
      const store: GameStore = {
        ...inner,
        publish: async (code, update) =>
          broken ? Promise.reject(new Error("down")) : inner.publish(code, update),
      };
      const { first, second } = await table(store);
      const before = second.last().version;
      const quiet = second.inbox.length;
      await vi.advanceTimersByTimeAsync(30_000);
      // Nothing changed, so the resync sends nothing.
      expect(second.inbox).toHaveLength(quiet);

      broken = true;
      await first.send({ type: "pickCard", index: 0 });
      await first.send({ type: "roll" });
      expect(second.last().version).toBe(before);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(second.last().version).toBe(before + 2);
      expect(second.last().events).toEqual([]);
      expect(second.last().view?.phase).toBe("move");
      expect(second.last().view?.dice).toEqual(first.last().view?.dice);

      // After closing, the timer is gone too.
      second.connection.close();
      const closedAt = second.inbox.length;
      await first.send({ type: "playCard", index: 0 }).catch(() => {});
      await vi.advanceTimersByTimeAsync(60_000);
      expect(second.inbox).toHaveLength(closedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never sends a seat the same version twice", async () => {
    vi.useFakeTimers();
    try {
      const { white, black, first } = await table();
      await first.send({ type: "pickCard", index: 0 });
      await vi.advanceTimersByTimeAsync(25_000);
      await first.send({ type: "roll" });
      await vi.advanceTimersByTimeAsync(25_000);
      for (const { inbox } of [white, black]) {
        const versions = inbox.flatMap((m) => (m.type === "state" ? [m.version] : []));
        expect(versions).toEqual([...new Set(versions)]);
        expect(versions).toEqual(versions.toSorted((a, b) => a - b));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the guest their seat even when announcing the join fails", async () => {
    vi.useFakeTimers();
    try {
      const inner = createMemoryStore();
      const store: GameStore = { ...inner, publish: () => Promise.reject(new Error("down")) };
      const host = await createRoom(store, "Ada");
      const white = await client(store, host.code, host.token);
      const guest = await joinRoom(store, host.code, "Grace");
      expect(guest.token).toBeTruthy();
      expect(white.last().view).toBeNull();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(white.last().view?.you).toBe("white");
      expect(white.last().lobby.players.black).toEqual({ name: "Grace", character: "gambler" });
      white.connection.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a version whose send failed, instead of counting it as sent", async () => {
    vi.useFakeTimers();
    try {
      const store = createMemoryStore();
      const host = await createRoom(store, "Ada");
      const got: number[] = [];
      let failNext = false;
      const connection = await openConnection(store, host.code, host.token, (m) => {
        if (m.type !== "state") return;
        if (failNext) {
          failNext = false;
          throw new Error("socket write failed");
        }
        got.push(m.version);
      });
      failNext = true;
      await joinRoom(store, host.code, "Grace");
      expect(got).toEqual([0]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(got).toEqual([0, 1]);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(got).toEqual([0, 1]);
      connection.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a command committed and retried when sending the mover their own move fails", async () => {
    vi.useFakeTimers();
    try {
      const inner = createMemoryStore();
      // No announcements, so the direct send to the mover is the only immediate delivery.
      const store: GameStore = { ...inner, publish: () => Promise.reject(new Error("down")) };
      const host = await createRoom(store, "Ada");
      const guest = await joinRoom(store, host.code, "Grace");
      const first = (await store.load(host.code))?.game?.current;
      const got: number[] = [];
      let failNext = false;
      const mover = await openConnection(
        store,
        host.code,
        first === "white" ? host.token : guest.token,
        (m) => {
          if (m.type !== "state") return;
          if (failNext) {
            failNext = false;
            throw new Error("socket write failed");
          }
          got.push(m.version);
        },
      );
      failNext = true;
      await expect(mover.command({ type: "pickCard", index: 0 })).resolves.toBeUndefined();
      expect((await store.load(host.code))?.version).toBe(2);
      expect(got).toEqual([1]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(got).toEqual([1, 2]);
      mover.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no listener behind when opening a connection fails part-way", async () => {
    const inner = createMemoryStore();
    const host = await createRoom(inner, "Ada");
    for (const failure of ["reject", "vanish", "send"] as const) {
      let loads = 0;
      let listeners = 0;
      const store: GameStore = {
        ...inner,
        load: async (code) => {
          loads++;
          if (loads === 2 && failure === "reject") throw new Error("store down");
          if (loads === 2 && failure === "vanish") return null;
          return inner.load(code);
        },
        subscribe: async (code, listener) => {
          listeners++;
          const stop = await inner.subscribe(code, listener);
          return () => {
            listeners--;
            stop();
          };
        },
      };
      const got: unknown[] = [];
      const send = (m: ServerMessage) => {
        if (failure === "send" && got.length === 0) {
          got.push("threw");
          throw new Error("socket write failed");
        }
        got.push(m);
      };
      await expect(openConnection(store, host.code, host.token, send), failure).rejects.toThrow();
      expect(listeners, failure).toBe(0);
      const before = got.length;
      await inner.publish(host.code, {
        room: { id: "other", code: host.code, version: 50, seats: {}, game: null },
        events: [],
      });
      expect(got, failure).toHaveLength(before);
    }
  });

  it("delivers nothing after close, even from a resync already in flight", async () => {
    vi.useFakeTimers();
    try {
      const inner = createMemoryStore();
      let release: (() => void) | null = null;
      let hold = false;
      const store: GameStore = {
        ...inner,
        load: async (code) => {
          const room = await inner.load(code);
          if (hold) await new Promise<void>((resolve) => (release = resolve));
          return room;
        },
        publish: async () => {},
      };
      const host = await createRoom(store, "Ada");
      const got: number[] = [];
      const connection = await openConnection(store, host.code, host.token, (m) => {
        if (m.type === "state") got.push(m.version);
      });
      await joinRoom(store, host.code, "Grace");
      expect(got).toEqual([0]);

      hold = true;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(release).not.toBeNull();
      connection.close();
      (release as unknown as () => void)();
      await vi.advanceTimersByTimeAsync(1);
      expect(got).toEqual([0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing after close, even when a command was already under way", async () => {
    const inner = createMemoryStore();
    let release: (() => void) | null = null;
    let hold = false;
    const store: GameStore = {
      ...inner,
      load: async (code) => {
        const room = await inner.load(code);
        if (hold) await new Promise<void>((resolve) => (release = resolve));
        return room;
      },
    };
    const host = await createRoom(store, "Ada");
    const white = await client(store, host.code, host.token);
    hold = true;
    const pending = white.send({ type: "roll" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    white.connection.close();
    (release as unknown as () => void)();
    await pending;
    expect(white.inbox).toHaveLength(1);
  });

  it("evicts a connection whose room code now belongs to a different game", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const store = createMemoryStore(1000, () => now);
      const fixed = (token: string) => ({ token: () => token, int: () => 0 });
      const old = await createRoom(store, "Ada", fixed("old-host"));
      const stale = await client(store, old.code, old.token);

      // The room expires and the same code is handed out again, to other people.
      now = 5000;
      const fresh = await createRoom(store, "Eve", fixed("new-host"));
      expect(fresh.code).toBe(old.code);
      await joinRoom(store, fresh.code, "Mallory", fixed("new-guest"));

      await vi.advanceTimersByTimeAsync(10_000);
      expect(stale.inbox.at(-1)).toEqual({
        type: "error",
        message: "That game no longer exists",
        fatal: true,
      });
      // Nothing from the new game reached the old connection, by push or by resync.
      expect(JSON.stringify(stale.inbox)).not.toContain("Eve");
      expect(stale.inbox.filter((m) => m.type === "state")).toHaveLength(1);

      const count = stale.inbox.length;
      await stale.send({ type: "roll" });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(stale.inbox).toHaveLength(count);
      expect((await store.load(fresh.code))?.version).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a command from a connection whose room was replaced, before any resync", async () => {
    let now = 0;
    const store = createMemoryStore(1000, () => now);
    const fixed = (token: string) => ({ token: () => token, int: () => 0 });
    const old = await createRoom(store, "Ada", fixed("old-host"));
    await joinRoom(store, old.code, "Grace", fixed("old-guest"));
    const stale = await client(store, old.code, "old-host");
    const staleGuest = await client(store, old.code, "old-guest");
    now = 5000;
    await createRoom(store, "Eve", fixed("new-host"));
    await joinRoom(store, old.code, "Mallory", fixed("new-guest"));
    const before = (await store.load(old.code))?.version;
    for (const connection of [stale, staleGuest]) {
      await connection.send({ type: "pickCard", index: 0 });
      expect(connection.inbox.at(-1)).toMatchObject({ type: "error", fatal: true });
    }
    expect((await store.load(old.code))?.version).toBe(before);
    expect(JSON.stringify([stale.inbox, staleGuest.inbox])).not.toContain("Mallory");
  });

  describe("when a room is replaced or gone", () => {
    /** A store whose loads can be overridden, and which counts live subscriptions. */
    function rigged() {
      const inner = createMemoryStore();
      const state = { listeners: 0, loads: 0, override: null as null | (() => Room | null) };
      const store: GameStore = {
        ...inner,
        load: async (code) => {
          state.loads++;
          return state.override ? state.override() : inner.load(code);
        },
        subscribe: async (code, listener) => {
          state.listeners++;
          const stop = await inner.subscribe(code, listener);
          let stopped = false;
          return () => {
            if (stopped) throw new Error("unsubscribed twice");
            stopped = true;
            state.listeners--;
            stop();
          };
        },
        subscribePresence: async (roomId, listener) => {
          state.listeners++;
          const stop = await inner.subscribePresence(roomId, listener);
          let stopped = false;
          return () => {
            if (stopped) throw new Error("unsubscribed presence twice");
            stopped = true;
            state.listeners--;
            stop();
          };
        },
      };
      return { inner, store, state };
    }
    const other = (code: string, version: number): Room => ({
      id: "someone-elses",
      code,
      version,
      seats: { white: { token: "theirs", name: "Eve" } },
      game: null,
    });

    it("refuses a room stored before rooms had ids", async () => {
      const inner = createMemoryStore();
      const host = await createRoom(inner, "Ada");
      const legacy = { ...(await inner.load(host.code)), id: undefined } as unknown as Room;
      const store: GameStore = { ...inner, load: async () => structuredClone(legacy) };
      const got: ServerMessage[] = [];
      await expect(
        openConnection(store, host.code, host.token, (m) => got.push(m)),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(got).toEqual([]);
    });

    it("evicts once, then stops polling, when the room is missing", async () => {
      vi.useFakeTimers();
      try {
        const { store, state } = rigged();
        const host = await createRoom(store, "Ada");
        const white = await client(store, host.code, host.token);
        state.override = () => null;
        await vi.advanceTimersByTimeAsync(10_000);
        expect(white.inbox.slice(1)).toEqual([
          { type: "error", message: "That game no longer exists", fatal: true },
        ]);
        expect(state.listeners).toBe(0);
        const loads = state.loads;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(state.loads).toBe(loads);
        expect(white.inbox).toHaveLength(2);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("evicts when a different room holds the code at the same or an older version", async () => {
      vi.useFakeTimers();
      try {
        for (const version of [0, 1, 5]) {
          const { store, state } = rigged();
          const host = await createRoom(store, "Ada");
          await joinRoom(store, host.code, "Grace");
          const white = await client(store, host.code, host.token);
          expect(white.last().version).toBe(1);
          state.override = () => other(host.code, version);
          await vi.advanceTimersByTimeAsync(10_000);
          expect(white.inbox.at(-1), `v${version}`).toMatchObject({ type: "error", fatal: true });
          expect(white.inbox.filter((m) => m.type === "state")).toHaveLength(1);
          expect(JSON.stringify(white.inbox)).not.toContain("Eve");
          expect(state.listeners).toBe(0);
          expect(vi.getTimerCount()).toBe(0);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("tears down even when the farewell cannot be sent", async () => {
      vi.useFakeTimers();
      try {
        const { store, state } = rigged();
        const host = await createRoom(store, "Ada");
        let fail = false;
        let attempts = 0;
        await openConnection(store, host.code, host.token, () => {
          attempts++;
          if (fail) throw new Error("socket write failed");
        });
        fail = true;
        state.override = () => other(host.code, 9);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(attempts).toBe(2);
        expect(state.listeners).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects, silently and with no timer, when the room is replaced during setup", async () => {
      vi.useFakeTimers();
      try {
        const { store, state } = rigged();
        const host = await createRoom(store, "Ada");
        const real = await store.load(host.code);
        let calls = 0;
        state.override = () => (calls++ === 0 ? real : other(host.code, 3));
        const got: ServerMessage[] = [];
        await expect(
          openConnection(store, host.code, host.token, (m) => got.push(m)),
        ).rejects.toMatchObject({ kind: "not_found" });
        expect(got).toEqual([]);
        expect(state.listeners).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(got).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("evicts when an announcement for a different room arrives on the code", async () => {
      const { inner, store, state } = rigged();
      const host = await createRoom(store, "Ada");
      const white = await client(store, host.code, host.token);
      await inner.publish(host.code, { room: other(host.code, 4), events: [] });
      expect(white.inbox.at(-1)).toMatchObject({ type: "error", fatal: true });
      expect(JSON.stringify(white.inbox)).not.toContain("Eve");
      expect(state.listeners).toBe(0);
      white.connection.close();
      white.connection.close();
    });

    it("cannot write into the replacement even when it appears between load and save", async () => {
      const inner = createMemoryStore();
      const host = await createRoom(inner, "Ada");
      const guest = await joinRoom(inner, host.code, "Grace");
      const original = await inner.load(host.code);
      if (!original?.game) throw new Error("no game");
      // The replacement is a started game at the very same version, with other players.
      const replacement: Room = {
        ...structuredClone(original),
        id: "someone-elses",
        seats: { white: { token: "w2", name: "Eve" }, black: { token: "b2", name: "Mallory" } },
      };
      let swap = false;
      const saves: boolean[] = [];
      // A store in which the room is swapped right after the mover has read it.
      const backing = createMemoryStore();
      await backing.create(original);
      const store: GameStore = {
        ...backing,
        save: async (room, expected) => {
          if (swap) {
            swap = false;
            const fresh = createMemoryStore();
            await fresh.create(replacement);
            Object.assign(store, { load: fresh.load, save: wrap(fresh.save) });
            return store.save(room, expected);
          }
          return wrap(backing.save)(room, expected);
        },
      };
      const wrap =
        (save: GameStore["save"]): GameStore["save"] =>
        async (room, expected) => {
          const ok = await save(room, expected);
          saves.push(ok);
          return ok;
        };
      const first = original.game.current;
      const mover = await client(store, host.code, first === "white" ? host.token : guest.token);
      swap = true;
      await mover.send({ type: "pickCard", index: 0 });
      expect(saves).toEqual([false]);
      expect(await store.load(host.code)).toEqual(replacement);
      expect(mover.inbox.at(-1)).toMatchObject({ type: "error", fatal: true });
      expect(JSON.stringify(mover.inbox)).not.toContain("Mallory");
    });
  });

  describe("rematch", () => {
    /** Ends the stored game with white as the winner, as if the last checker had come off. */
    async function finished() {
      const t = await table();
      const room = (await t.store.load(t.code)) as Room;
      const game = room.game as NonNullable<Room["game"]>;
      const over: Room = {
        ...room,
        version: room.version + 1,
        game: { ...game, phase: "over", winner: "white", dice: [], wins: { white: 1, black: 0 } },
      };
      expect(await t.store.save(over, room.version)).toBe(true);
      await t.store.publish(t.code, { room: over, events: [] });
      return t;
    }

    it("is refused during a game", async () => {
      const { first, second } = await table();
      await first.send({ type: "rematch" });
      await second.send({ type: "rematch" });
      expect(first.errors()).toEqual(["The game is not over yet"]);
      expect(second.errors()).toEqual(["The game is not over yet"]);
      expect(first.last().view?.phase).not.toBe("over");
    });

    it("tells both players who has asked, and starts a new game when both have", async () => {
      const { white, black } = await finished();
      await black.send({ type: "rematch" });
      for (const seat of [white, black]) {
        expect(seat.last().view).toMatchObject({
          phase: "over",
          winner: "white",
          rematch: { white: false, black: true },
        });
        expect(seat.last().events).toEqual([{ type: "rematchOffered", player: "black" }]);
      }
      await black.send({ type: "rematch" });
      expect(black.errors()).toEqual(["You have already asked for a rematch"]);

      await white.send({ type: "rematch" });
      for (const seat of [white, black]) {
        const { view, events, lobby } = seat.last();
        expect(view).toMatchObject({
          winner: null,
          wins: { white: 1, black: 0 },
          rematch: { white: false, black: false },
          board: newGame(1).state.board,
        });
        expect(view?.phase).not.toBe("over");
        expect(events[0]).toEqual({ type: "gameStarted", first: view?.current });
        expect(lobby.players.white?.name).toBe("Ada");
        expect(lobby.players.black?.name).toBe("Grace");
      }
      expect(white.last().view?.you).toBe("white");
      expect(black.last().view?.you).toBe("black");
    });

    it("deals the rematch from three fresh secrets, never from the finished game", async () => {
      const store = createMemoryStore();
      const drawn: number[] = [];
      let next = 1000;
      const entropy = {
        token: () => `tok${next++}`,
        int: (n: number) => {
          const value = next++ % n;
          drawn.push(value);
          return value;
        },
      };
      const host = await createRoom(store, "Ada", entropy);
      const guest = await joinRoom(store, host.code, "Grace", entropy);
      const room = (await store.load(host.code)) as Room;
      const game = room.game as NonNullable<Room["game"]>;
      const asked = { white: false, black: true };
      const over = { ...game, phase: "over" as const, winner: "white" as const, rematch: asked };
      await store.save({ ...room, version: room.version + 1, game: over }, room.version);
      const white = await openConnection(store, host.code, host.token, () => {}, { entropy });
      drawn.length = 0;
      await white.command({ type: "rematch" });
      white.close();
      void guest;
      // One reseed for the command, then one seed per deck and one for play.
      expect(drawn).toHaveLength(4);
      const [, w = -1, b = -1, play = -1] = drawn;
      const started = (await store.load(host.code))?.game;
      expect(started?.cards).toEqual(newGame({ white: w, black: b, play }).state.cards);
    });

    it("keeps a game saved before matches had a score playable", async () => {
      const { store, code, first } = await table();
      const room = (await store.load(code)) as Room;
      const { wins: _wins, rematch: _rematch, ...old } = room.game as NonNullable<Room["game"]>;
      await store.save(
        { ...room, version: room.version + 1, game: old as Room["game"] },
        room.version,
      );
      await store.publish(code, { room: (await store.load(code)) as Room, events: [] });
      expect(first.last().view?.wins).toEqual({ white: 0, black: 0 });
      await first.send({ type: "pickCard", index: 0 });
      expect(first.errors()).toEqual([]);
      expect((await store.load(code))?.game?.rematch).toEqual({ white: false, black: false });
    });
  });

  it("counts the win of a game that was finished before matches had a score", async () => {
    const { store, code, white, black } = await table();
    const room = (await store.load(code)) as Room;
    const { wins: _wins, rematch: _rematch, ...old } = room.game as NonNullable<Room["game"]>;
    const over = { ...old, phase: "over", winner: "black", dice: [] } as unknown as Room["game"];
    await store.save({ ...room, version: room.version + 1, game: over }, room.version);
    await store.publish(code, { room: (await store.load(code)) as Room, events: [] });
    expect(white.last().view?.wins).toEqual({ white: 0, black: 1 });
    await white.send({ type: "rematch" });
    await black.send({ type: "rematch" });
    expect(black.last().view).toMatchObject({ winner: null, wins: { white: 0, black: 1 } });
  });

  it("reports a room that vanished as a fatal error", async () => {
    let gone = false;
    const inner = createMemoryStore();
    const store: GameStore = { ...inner, load: async (c) => (gone ? null : inner.load(c)) };
    const { first } = await table(store);
    gone = true;
    await first.send({ type: "pickCard", index: 0 });
    expect(first.inbox.at(-1)).toEqual({
      type: "error",
      message: "That game no longer exists",
      fatal: true,
    });
  });

  describe("disconnect and claim victory", () => {
    const presences = (inbox: ServerMessage[]) =>
      inbox.flatMap((m) => (m.type === "presence" ? [m] : []));

    it("notifies the remaining player when their opponent leaves, waits 30s without auto-ending, and lets them claim victory", async () => {
      vi.useFakeTimers();
      try {
        const { store, code, host, guest, white, black } = await table();
        expect(presences(white.inbox)).toEqual([]);

        // Black disconnects mid-game.
        black.connection.close();
        await vi.advanceTimersByTimeAsync(1);
        expect(presences(white.inbox)).toEqual([
          { type: "presence", online: false, claimInMs: CLAIM_GRACE_MS },
        ]);

        // Claiming before 30s is refused and tells them how long is left.
        await vi.advanceTimersByTimeAsync(10_000);
        await white.send({ type: "claimVictory" });
        expect(white.errors().at(-1)).toBe("Wait 20s before claiming victory");
        expect((await store.load(code))?.game?.phase).not.toBe("over");

        // Even well past 30s the game never auto-ends on its own.
        await vi.advanceTimersByTimeAsync(60_000);
        expect((await store.load(code))?.game?.phase).not.toBe("over");

        // Now claiming victory succeeds (regardless of whose turn it was).
        await white.send({ type: "claimVictory" });
        expect(white.last().view).toMatchObject({
          phase: "over",
          winner: "white",
          winReason: "abandoned",
          wins: { white: 1, black: 0 },
        });
        expect(white.last().events).toEqual([{ type: "gameWon", winner: "white" }]);

        // If black later reconnects, they receive the final abandoned result.
        const returned = await client(store, code, guest.token);
        expect(returned.last().view).toMatchObject({
          phase: "over",
          winner: "white",
          winReason: "abandoned",
        });
        returned.connection.close();
        white.connection.close();
        void host;
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancels abandonment and blocks claiming when the opponent reconnects in time", async () => {
      vi.useFakeTimers();
      try {
        const { store, code, guest, white, black } = await table();
        black.connection.close();
        await vi.advanceTimersByTimeAsync(1);
        expect(presences(white.inbox).at(-1)).toEqual({
          type: "presence",
          online: false,
          claimInMs: CLAIM_GRACE_MS,
        });

        // 20 seconds later, black reconnects.
        await vi.advanceTimersByTimeAsync(20_000);
        const back = await client(store, code, guest.token);
        await vi.advanceTimersByTimeAsync(1);
        expect(presences(white.inbox).at(-1)).toEqual({
          type: "presence",
          online: true,
          claimInMs: null,
        });

        // Even after another 20s, white cannot claim victory because black is back.
        await vi.advanceTimersByTimeAsync(20_000);
        await white.send({ type: "claimVictory" });
        expect(white.errors().at(-1)).toBe("Your opponent is connected");
        expect((await store.load(code))?.game?.phase).not.toBe("over");
        back.connection.close();
        white.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not trigger a disconnect during proactive socket rotation or multi-tab close", async () => {
      vi.useFakeTimers();
      try {
        const { store, code, guest, white, black } = await table();
        // Second socket opens for black before the first retires.
        const rotated = await client(store, code, guest.token);
        black.connection.close();
        await vi.advanceTimersByTimeAsync(5000);
        expect(presences(white.inbox)).toEqual([]);

        await white.send({ type: "claimVictory" });
        expect(white.errors().at(-1)).toBe("Your opponent is connected");

        // Closing the final remaining socket DOES mark black away.
        rotated.connection.close();
        await vi.advanceTimersByTimeAsync(1);
        expect(presences(white.inbox)).toEqual([
          { type: "presence", online: false, claimInMs: CLAIM_GRACE_MS },
        ]);
        white.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("sends accurate remaining claim time when the remaining player refreshes mid-countdown", async () => {
      vi.useFakeTimers();
      try {
        const { store, code, host, white, black } = await table();
        black.connection.close();
        await vi.advanceTimersByTimeAsync(12_000);

        // White reloads their tab: initial state snapshot carries the exact remaining time.
        white.connection.close();
        const reloaded = await client(store, code, host.token);
        expect(reloaded.last().presence).toEqual({
          online: false,
          claimInMs: CLAIM_GRACE_MS - 12_000,
        });
        reloaded.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("handles an opponent who never connects after matching, after the arrival grace window", async () => {
      vi.useFakeTimers();
      try {
        const store = createMemoryStore();
        const matched = await createMatchedRoom(
          store,
          { name: "Ada", character: "gambler" },
          { name: "Grace", character: "seer" },
        );
        const white = await client(store, matched.code, matched.tokens.white);
        // Immediately after game start, Grace is still in the arrival window: no false alert.
        expect(white.last().presence).toEqual({ online: true, claimInMs: null });
        expect(presences(white.inbox)).toEqual([]);

        // Once the arrival window elapses without Grace connecting, white is notified.
        await vi.advanceTimersByTimeAsync(ARRIVAL_GRACE_MS);
        expect(presences(white.inbox)).toEqual([
          { type: "presence", online: false, claimInMs: CLAIM_GRACE_MS },
        ]);

        // After the 30s claim grace, white can claim victory.
        await vi.advanceTimersByTimeAsync(CLAIM_GRACE_MS);
        await white.send({ type: "claimVictory" });
        expect(white.last().view).toMatchObject({
          phase: "over",
          winner: "white",
          winReason: "abandoned",
        });
        white.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("detects a crashed opponent instance once its lease expires without drifting", async () => {
      vi.useFakeTimers();
      try {
        const store = createMemoryStore();
        const host = await createRoom(store, "Ada");
        await joinRoom(store, host.code, "Grace");
        const room = (await store.load(host.code)) as Room;
        const white = await client(store, host.code, host.token);
        // Simulate black's process registering a lease and then dying without closing.
        await store.connectSeat(room.id, "black", "crashed-conn", PRESENCE_LEASE_MS);

        // Before lease expiry, black still appears online.
        await vi.advanceTimersByTimeAsync(20_000);
        expect(presences(white.inbox)).toEqual([]);

        // On the next resync after lease expiry (t = 30s, lease expired at 25s -> 5s elapsed).
        await vi.advanceTimersByTimeAsync(10_000);
        expect(presences(white.inbox)).toEqual([
          { type: "presence", online: false, claimInMs: CLAIM_GRACE_MS - 5000 },
        ]);

        // 25s later (30s after the 25s lease expiry), white can claim victory.
        await vi.advanceTimersByTimeAsync(25_000);
        await white.send({ type: "claimVictory" });
        expect(white.last().view).toMatchObject({ winner: "white", winReason: "abandoned" });
        white.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not let a rematch inherit disconnect time from the previous game's result screen", async () => {
      vi.useFakeTimers();
      try {
        const { store, code, white, black } = await table();
        const room = (await store.load(code)) as Room;
        const over: Room = {
          ...room,
          version: room.version + 1,
          game: {
            ...(room.game as NonNullable<Room["game"]>),
            phase: "over",
            winner: "white",
            winReason: "bearOff",
            dice: [],
            wins: { white: 1, black: 0 },
          },
        };
        await store.save(over, room.version);
        await store.publish(code, { room: over, events: [] });

        // Black asks for a rematch, then disconnects and stays away for 40s.
        await black.send({ type: "rematch" });
        black.connection.close();
        await vi.advanceTimersByTimeAsync(40_000);

        // White accepts the rematch: Game 2 starts fresh and must NOT be immediately claimable.
        await white.send({ type: "rematch" });
        expect(white.last().view?.phase).not.toBe("over");
        expect(white.last().presence).toEqual({ online: false, claimInMs: CLAIM_GRACE_MS });
        await white.send({ type: "claimVictory" });
        expect(white.errors().at(-1)).toBe("Wait 30s before claiming victory");

        // After 30s in Game 2, white can claim victory.
        await vi.advanceTimersByTimeAsync(CLAIM_GRACE_MS);
        await white.send({ type: "claimVictory" });
        expect(white.last().view).toMatchObject({
          phase: "over",
          winner: "white",
          winReason: "abandoned",
          wins: { white: 2, black: 0 },
        });
        white.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("registers the seat lease before sending the initial state so socket rotation never false-disconnects", async () => {
      const store = createMemoryStore();
      const host = await createRoom(store, "Ada");
      const guest = await joinRoom(store, host.code, "Grace");
      const room = (await store.load(host.code)) as Room;
      const white = await client(store, host.code, host.token);
      const oldBlack = await client(store, host.code, guest.token);

      // The instant the replacement socket receives its first state, close the old socket
      // (mirroring remoteSession's immediate handover).
      let leasePresentAtFirstState = false;
      let countAtFirstState = 0;
      const newBlack = await openConnection(store, host.code, guest.token, (message) => {
        if (message.type === "state" && !leasePresentAtFirstState) {
          leasePresentAtFirstState = true;
          oldBlack.connection.close();
        }
      });
      // Confirm both leases existed before oldBlack closed by checking white never got away.
      await new Promise((resolve) => setTimeout(resolve, 10));
      countAtFirstState = Object.keys(
        (await store.getPresence(room.id)).presence.black.connections,
      ).length;
      expect(leasePresentAtFirstState).toBe(true);
      expect(countAtFirstState).toBe(1);
      expect(presences(white.inbox)).toEqual([]);
      newBlack.close();
      white.connection.close();
    });

    it("recovers a healthy open socket whose lease lapsed during a long stall", async () => {
      vi.useFakeTimers();
      try {
        let now = 0;
        const store = createMemoryStore(undefined, () => now);
        const host = await createRoom(store, "Ada");
        const guest = await joinRoom(store, host.code, "Grace");
        const white = await client(store, host.code, host.token);
        const black = await client(store, host.code, guest.token);

        // Stall black's clock past the 25s lease without closing its socket, then let white observe it.
        now = PRESENCE_LEASE_MS + 5000;
        await vi.advanceTimersByTimeAsync(10_000);
        // After the resync tick runs for both open sockets, black's open socket has healed its
        // lease and white is not able to claim victory against a live connection.
        await white.send({ type: "claimVictory" });
        expect(white.errors().at(-1)).toBe("Your opponent is connected");
        expect((await store.load(host.code))?.game?.phase).not.toBe("over");
        white.connection.close();
        black.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores out-of-order stale presence broadcasts and keeps presence off the move channel", async () => {
      const { store, code, white, black, first } = await table();
      const room = (await store.load(code)) as Room;
      const before = room.version;
      const moveChannelEvents: number[] = [];
      const stopMoveWatch = await store.subscribe(code, (u) => {
        moveChannelEvents.push(u.events.length);
      });

      const snap = await store.getPresence(room.id);
      await store.publishPresence(room.id, {
        roomId: room.id,
        presence: {
          ...snap.presence,
          revision: snap.presence.revision + 5,
          black: { connections: {}, disconnectedAt: snap.now },
        },
        at: snap.now,
      });
      // An out-of-order older revision claiming black is online must be ignored.
      await store.publishPresence(room.id, {
        roomId: room.id,
        presence: {
          ...snap.presence,
          revision: snap.presence.revision + 1,
          black: { connections: { stale: snap.now + 60_000 }, disconnectedAt: null },
        },
        at: snap.now,
      });
      expect(presences(white.inbox)).toEqual([
        { type: "presence", online: false, claimInMs: CLAIM_GRACE_MS },
      ]);

      // Closing a connection publishes ONLY on the presence channel — never on `room:<code>`,
      // so a pre-deployment server listening to `room:<code>` can never swallow move events.
      black.connection.close();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(moveChannelEvents).toEqual([]);

      // Real move at `before + 1` still delivers its events intact!
      await first.send({ type: "pickCard", index: 0 });
      expect(white.last().version).toBe(before + 1);
      expect(white.last().events).toHaveLength(1);
      expect(moveChannelEvents).toEqual([1]);
      stopMoveWatch();
      white.connection.close();
    });

    it("keeps pre-deployment rooms and unmarked seats ineligible for abandonment claims", async () => {
      vi.useFakeTimers();
      try {
        const store = createMemoryStore();
        const host = await createRoom(store, "Ada");
        await joinRoom(store, host.code, "Grace");
        // Strip gameStartedAt and seat.presence to simulate a room saved before this feature deployed.
        const loaded = (await store.load(host.code)) as Room;
        const { gameStartedAt: _dropped, ...legacy } = loaded;
        await store.save(
          {
            ...legacy,
            version: loaded.version + 1,
            seats: {
              white: { token: host.token, name: "Ada", character: "gambler" },
              black: {
                token: loaded.seats.black!.token,
                name: "Grace",
                character: "gambler",
              },
            },
          },
          loaded.version,
        );

        // Only Ada returns after the deploy; Grace could still be on (or rotate onto) an old server.
        const white = await client(store, host.code, host.token);
        expect(white.last().presence).toEqual({ online: true, claimInMs: null });

        // Even 10+ minutes later (past multiple 240s old-server rotations), Grace stays ineligible.
        await vi.advanceTimersByTimeAsync(600_000);
        expect(presences(white.inbox)).toEqual([]);
        await white.send({ type: "claimVictory" });
        expect(white.errors().at(-1)).toBe("Your opponent is connected");
        white.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps an unmarked host ineligible even when a presence-aware guest joins on a new server", async () => {
      vi.useFakeTimers();
      try {
        const store = createMemoryStore();
        // Pre-deployment waiting lobby: white seat has no `presence: true` flag.
        await store.create({
          id: "legacy-lobby",
          code: "OLDLB",
          version: 0,
          seats: { white: { token: "host-tok", name: "Ada", character: "gambler" } },
          game: null,
        });

        // Guest joins on the new server (writes gameStartedAt, sets black.presence = true).
        const guest = await joinRoom(store, "OLDLB", "Grace");
        const black = await client(store, "OLDLB", guest.token);

        // Even 10+ minutes later (covering old-server rotations), host cannot be claimed against.
        await vi.advanceTimersByTimeAsync(600_000);
        expect(presences(black.inbox)).toEqual([]);
        await black.send({ type: "claimVictory" });
        expect(black.errors().at(-1)).toBe("Your opponent is connected");
        black.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("re-delivers online presence on resync after a socket crosses a game-over/rematch stage boundary", async () => {
      vi.useFakeTimers();
      try {
        const { store, code, white, black } = await table();
        const room = (await store.load(code)) as Room;
        // Advance room to game-over v2 while black is online (white's lastKey = "1:over:online").
        const over: Room = {
          ...room,
          version: room.version + 1,
          game: {
            ...(room.game as NonNullable<Room["game"]>),
            phase: "over",
            winner: "white",
            winReason: "bearOff",
            dice: [],
            wins: { white: 1, black: 0 },
            rematch: { white: false, black: false },
          },
        };
        await store.save(over, room.version);
        const snap = await store.getPresence(room.id);
        await store.publish(code, {
          room: over,
          events: [],
          presence: snap.presence,
          at: snap.now,
        });
        const countBefore = presences(white.inbox).length;

        // Now suppose white missed the rematch boundary frame and receives an ordinary move in
        // game 2 (v4, no presence attached). Resync must still deliver `online: true` because
        // the stage changed from `1:over` to `1:active`.
        const rematchMove: Room = {
          ...over,
          version: over.version + 2,
          game: {
            ...over.game!,
            phase: "roll",
            winner: null,
            winReason: null,
          },
          gameStartedAt: Date.now(),
          gameStartedMatch: 1,
        };
        await store.save(rematchMove, over.version);
        await store.publish(code, { room: rematchMove, events: [] });

        await vi.advanceTimersByTimeAsync(10_000);
        expect(presences(white.inbox).slice(countBefore)).toEqual([
          { type: "presence", online: true, claimInMs: null },
        ]);
        white.connection.close();
        black.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores a delayed same-revision presence broadcast with an older timestamp", async () => {
      vi.useFakeTimers();
      try {
        const store = createMemoryStore();
        const matched = await createMatchedRoom(
          store,
          { name: "Ada", character: "gambler" },
          { name: "Grace", character: "seer" },
        );
        const room = (await store.load(matched.code)) as Room;
        const white = await client(store, matched.code, matched.tokens.white);
        // Capture initial presence snapshot (rev 1, at t=0, within 10s arrival grace).
        const initialSnap = await store.getPresence(room.id);

        // Advance past arrival grace: resync marks Grace away without bumping revision.
        await vi.advanceTimersByTimeAsync(ARRIVAL_GRACE_MS);
        expect(presences(white.inbox)).toEqual([
          { type: "presence", online: false, claimInMs: CLAIM_GRACE_MS },
        ]);

        // Releasing the delayed initial broadcast (same revision, older timestamp) must NOT
        // falsely flip Grace back to online.
        await store.publishPresence(room.id, {
          roomId: room.id,
          presence: initialSnap.presence,
          at: initialSnap.now,
        });
        expect(presences(white.inbox)).toEqual([
          { type: "presence", online: false, claimInMs: CLAIM_GRACE_MS },
        ]);
        white.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not attach stale cached presence on ordinary moves that would rewind the countdown", async () => {
      vi.useFakeTimers();
      try {
        const { first, second } = await table();
        second.connection.close();
        await vi.advanceTimersByTimeAsync(9000);

        await first.send({ type: "pickCard", index: 0 });
        expect(first.last().presence).toBeUndefined();
        first.connection.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it("retains a newer disconnect broadcast that arrives while connectSeat is still in flight", async () => {
      const inner = createMemoryStore();
      const host = await createRoom(inner, "Ada");
      const guest = await joinRoom(inner, host.code, "Grace");
      const black = await client(inner, host.code, guest.token);

      let releaseConnect: (() => void) | null = null;
      const store: GameStore = {
        ...inner,
        connectSeat: async (roomId, seat, connId, leaseMs) => {
          const result = await inner.connectSeat(roomId, seat, connId, leaseMs);
          if (seat === "white") {
            await new Promise<void>((resolve) => {
              releaseConnect = resolve;
            });
          }
          return result;
        },
      };

      const whiteInbox: ServerMessage[] = [];
      const opening = openConnection(store, host.code, host.token, (m) => whiteInbox.push(m));
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Black disconnects AFTER white's connectSeat took its snapshot, BEFORE openConnection finishes.
      black.connection.close();
      await new Promise((resolve) => setTimeout(resolve, 10));
      (releaseConnect as unknown as () => void)();
      const white = await opening;

      const initial = whiteInbox.find((m): m is State => m.type === "state");
      expect(initial?.presence).toMatchObject({ online: false });
      white.close();
    });

    it("allows fresh connections to both active and finished legacy rooms saved before match scores existed", async () => {
      const store = createMemoryStore();
      const host = await createRoom(store, "Ada");
      await joinRoom(store, host.code, "Grace");
      const loaded = (await store.load(host.code)) as Room;
      const { wins: _w, rematch: _r, winReason: _wr, ...activeLegacyGame } = loaded.game!;
      await store.save(
        {
          id: loaded.id,
          code: loaded.code,
          version: loaded.version + 1,
          seats: loaded.seats,
          game: activeLegacyGame as unknown as Room["game"],
        },
        loaded.version,
      );
      const activeConn = await client(store, host.code, host.token);
      expect(activeConn.last().view?.wins).toEqual({ white: 0, black: 0 });
      expect(activeConn.last().presence).toEqual({ online: true, claimInMs: null });
      activeConn.connection.close();

      // Same for an already-finished legacy room missing `wins`.
      const finishedLegacyGame = {
        ...activeLegacyGame,
        phase: "over" as const,
        winner: "white" as const,
        dice: [],
      };
      await store.save(
        {
          id: loaded.id,
          code: loaded.code,
          version: loaded.version + 2,
          seats: loaded.seats,
          game: finishedLegacyGame as unknown as Room["game"],
        },
        loaded.version + 1,
      );
      const finishedConn = await client(store, host.code, host.token);
      expect(finishedConn.last().view?.wins).toEqual({ white: 1, black: 0 });
      expect(finishedConn.last().view?.winReason).toBe("bearOff");
      expect(finishedConn.last().presence).toEqual({ online: true, claimInMs: null });
      finishedConn.connection.close();
    });

    it("does not let a delayed older game-over update clear a newer rematch countdown", async () => {
      let now = 10_000;
      const { store, code, white, black } = await table(createMemoryStore(undefined, () => now));
      const room = (await store.load(code)) as Room;
      const over: Room = {
        ...room,
        version: room.version + 1,
        game: {
          ...(room.game as NonNullable<Room["game"]>),
          phase: "over",
          winner: "white",
          winReason: "bearOff",
          dice: [],
          wins: { white: 1, black: 0 },
          rematch: { white: false, black: true },
        },
      };
      await store.save(over, room.version);
      await store.publish(code, { room: over, events: [] });

      black.connection.close();
      await new Promise((resolve) => setTimeout(resolve, 10));
      now += 15_000;
      await white.send({ type: "rematch" });
      expect(white.last().presence).toMatchObject({ online: false, claimInMs: CLAIM_GRACE_MS });
      const countBefore = presences(white.inbox).length;

      // Now deliver the delayed older game-over update at the same presence revision.
      const snap = await store.getPresence(room.id);
      await store.publish(code, {
        room: over,
        events: [],
        presence: snap.presence,
        at: snap.now,
      });
      expect(presences(white.inbox)).toHaveLength(countBefore);
      white.connection.close();
    });

    it("releases the subscription when eviction fires before subscribe() resolves", async () => {
      const inner = createMemoryStore();
      const host = await createRoom(inner, "Ada");
      let listeners = 0;
      const store: GameStore = {
        ...inner,
        subscribe: async (code, listener) => {
          listeners++;
          const unsub = await inner.subscribe(code, listener);
          // Replacement-room broadcast arrives before subscribe() returns its handle.
          listener({
            room: { id: "different-room", code, version: 1, seats: {}, game: null },
            events: [],
          });
          return () => {
            listeners--;
            unsub();
          };
        },
      };
      await expect(openConnection(store, host.code, host.token, () => {})).rejects.toMatchObject({
        kind: "not_found",
      });
      expect(listeners).toBe(0);
    });

    it("still delivers a committed rematch even if reading presence afterwards fails", async () => {
      const inner = createMemoryStore();
      let failPresence = false;
      const store: GameStore = {
        ...inner,
        getPresence: async (roomId) => {
          if (failPresence) throw new Error("redis blip");
          return inner.getPresence(roomId);
        },
      };
      const { code, white, black } = await table(store);
      const room = (await store.load(code)) as Room;
      const over: Room = {
        ...room,
        version: room.version + 1,
        game: {
          ...(room.game as NonNullable<Room["game"]>),
          phase: "over",
          winner: "white",
          winReason: "bearOff",
          dice: [],
          wins: { white: 1, black: 0 },
          rematch: { white: false, black: true },
        },
      };
      await store.save(over, room.version);
      await store.publish(code, { room: over, events: [] });

      failPresence = true;
      await expect(white.send({ type: "rematch" })).resolves.toBeUndefined();
      expect(white.errors()).toEqual([]);
      expect(white.last().view?.phase).not.toBe("over");
      expect(white.last().events[0]).toMatchObject({ type: "gameStarted" });
      white.connection.close();
      black.connection.close();
    });
  });
});
