import { describe, expect, it } from "vitest";

import {
  cancelledSeeker,
  emptyPresence,
  type GameStore,
  type PresenceUpdate,
  type Room,
  type RoomUpdate,
  type Seeker,
} from "../src/server/store.ts";

function room(code: string, version = 0, id = "room-1"): Room {
  return { id, code, version, seats: { white: { token: "t", name: "Ada" } }, game: null };
}

function seeker(id: string, since: number, seen = since): Seeker {
  return { id, name: id, character: "gambler", since, seen };
}

const grant = (token: string) => ({ code: "AAAAA", token });

/** Behaviour every `GameStore` must share. Run it against each implementation. */
export function storeContract(name: string, makeStore: (now?: () => number) => GameStore): void {
  describe(`${name} store contract`, () => {
    it("creates, loads and refuses a duplicate code", async () => {
      const store = makeStore();
      expect(await store.load("AAAAA")).toBeNull();
      expect(await store.create(room("AAAAA"))).toBe(true);
      expect(await store.create(room("AAAAA"))).toBe(false);
      expect(await store.load("AAAAA")).toEqual(room("AAAAA"));
    });

    it("saves only when the expected version still matches", async () => {
      const store = makeStore();
      await store.create(room("AAAAA"));
      expect(await store.save(room("AAAAA", 1), 0)).toBe(true);
      // A second writer that also read version 0 loses.
      expect(await store.save(room("AAAAA", 1), 0)).toBe(false);
      expect((await store.load("AAAAA"))?.version).toBe(1);
      expect(await store.save(room("BBBBB", 1), 0)).toBe(false);
    });

    it("refuses to save over a different room that now holds the same code", async () => {
      const store = makeStore();
      await store.create(room("AAAAA", 0, "replacement"));
      // A writer that read an earlier room with this code, at the same version.
      expect(await store.save(room("AAAAA", 1, "expired"), 0)).toBe(false);
      expect(await store.load("AAAAA")).toEqual(room("AAAAA", 0, "replacement"));
      expect(await store.save(room("AAAAA", 1, "replacement"), 0)).toBe(true);
    });

    it("treats two registrations of the same function as separate", async () => {
      const store = makeStore();
      const seen: number[] = [];
      const listener = (u: RoomUpdate) => seen.push(u.room.version);
      const keepAlive = await store.subscribe("AAAAA", () => {});
      const stopFirst = await store.subscribe("AAAAA", listener);
      stopFirst();
      const stopSecond = await store.subscribe("AAAAA", listener);
      stopFirst();
      await store.publish("AAAAA", { room: room("AAAAA", 1), events: [] });
      expect(seen).toEqual([1]);
      stopSecond();
      keepAlive();
    });

    it("hands out copies, never shared references", async () => {
      const store = makeStore();
      const original = room("AAAAA");
      await store.create(original);
      original.seats.white = { token: "changed", name: "Eve" };
      const loaded = await store.load("AAAAA");
      expect(loaded?.seats.white?.token).toBe("t");
      if (loaded) loaded.version = 99;
      expect((await store.load("AAAAA"))?.version).toBe(0);
    });

    it("lets an old unsubscribe be called again without detaching a newer subscriber", async () => {
      const store = makeStore();
      const first: number[] = [];
      const second: number[] = [];
      const stopFirst = await store.subscribe("AAAAA", (u) => first.push(u.room.version));
      stopFirst();
      const stopSecond = await store.subscribe("AAAAA", (u) => second.push(u.room.version));
      stopFirst();
      await store.publish("AAAAA", { room: room("AAAAA", 1), events: [] });
      expect(first).toEqual([]);
      expect(second).toEqual([1]);
      stopSecond();
      stopSecond();
      await store.publish("AAAAA", { room: room("AAAAA", 2), events: [] });
      expect(second).toEqual([1]);
    });

    it("keeps delivering when one listener throws", async () => {
      const store = makeStore();
      const seen: number[] = [];
      await store.subscribe("AAAAA", () => {
        throw new Error("listener failed");
      });
      await store.subscribe("AAAAA", (u) => seen.push(u.room.version));
      await store.publish("AAAAA", { room: room("AAAAA", 1), events: [] });
      await store.publish("AAAAA", { room: room("AAAAA", 2), events: [] });
      expect(seen).toEqual([1, 2]);
    });

    it("gives each listener its own copy of an update", async () => {
      const store = makeStore();
      const seen: RoomUpdate[] = [];
      await store.subscribe("AAAAA", (u) => {
        u.room.version = 99;
      });
      await store.subscribe("AAAAA", (u) => seen.push(u));
      await store.publish("AAAAA", { room: room("AAAAA", 1), events: [] });
      expect(seen[0]?.room.version).toBe(1);
    });

    it("delivers published updates to subscribers of that room only", async () => {
      const store = makeStore();
      const a: RoomUpdate[] = [];
      const b: RoomUpdate[] = [];
      const stopA = await store.subscribe("AAAAA", (u) => a.push(u));
      await store.subscribe("BBBBB", (u) => b.push(u));
      await store.publish("AAAAA", { room: room("AAAAA", 3), events: [] });
      expect(a).toEqual([{ room: room("AAAAA", 3), events: [] }]);
      expect(b).toEqual([]);

      stopA();
      await store.publish("AAAAA", { room: room("AAAAA", 4), events: [] });
      expect(a).toHaveLength(1);
    });

    it("delivers presence updates on their own channel, isolated from room move channels", async () => {
      const store = makeStore();
      const moves: RoomUpdate[] = [];
      const seenA: PresenceUpdate[] = [];
      const seenB: PresenceUpdate[] = [];
      const stopMove = await store.subscribe("AAAAA", (u) => moves.push(u));
      const stopA = await store.subscribePresence("room-1", (u) => seenA.push(u));
      const stopB = await store.subscribePresence("room-2", (u) => seenB.push(u));
      const update: PresenceUpdate = {
        roomId: "room-1",
        presence: { ...emptyPresence(), revision: 3 },
        at: 5000,
      };
      await store.publishPresence("room-1", update);
      expect(seenA).toEqual([update]);
      expect(seenB).toEqual([]);
      expect(moves).toEqual([]);

      stopA();
      await store.publishPresence("room-1", { ...update, at: 6000 });
      expect(seenA).toHaveLength(1);
      stopB();
      stopMove();
    });

    it("lists waiting seekers longest first and moves seen forward on a touch", async () => {
      const store = makeStore();
      await store.addSeeker(seeker("late", 2000));
      await store.addSeeker(seeker("early", 1000));
      expect((await store.waitingSeekers(10)).map((s) => s.id)).toEqual(["early", "late"]);
      expect((await store.waitingSeekers(1)).map((s) => s.id)).toEqual(["early"]);
      expect(await store.touchSeeker("early", 5000)).toEqual(seeker("early", 1000, 5000));
      expect((await store.waitingSeekers(1))[0]?.seen).toBe(5000);
      expect(await store.touchSeeker("nobody", 5000)).toBeNull();
    });

    it("pairs two fresh waiting seekers once, handing each their seat", async () => {
      const store = makeStore();
      await store.addSeeker(seeker("a", 1000));
      await store.addSeeker(seeker("b", 2000));
      await store.addSeeker(seeker("c", 3000));
      const pair = (x: string, y: string) =>
        store.pairSeekers({ id: x, grant: grant(x) }, { id: y, grant: grant(y) }, 0);
      expect(await pair("a", "a")).toBe(false);
      expect(await pair("a", "b")).toBe(true);
      // Neither can be taken a second time.
      expect(await pair("c", "a")).toBe(false);
      expect(await pair("b", "c")).toBe(false);
      expect((await store.waitingSeekers(10)).map((s) => s.id)).toEqual(["c"]);
      // A matched seeker keeps their seat, and a touch no longer moves seen.
      expect(await store.touchSeeker("a", 9000)).toEqual({
        ...seeker("a", 1000),
        grant: grant("a"),
      });
      expect((await store.touchSeeker("b", 9000))?.grant).toEqual(grant("b"));
    });

    it("refuses to pair a seeker who has not been seen lately, or who is gone", async () => {
      const store = makeStore();
      await store.addSeeker(seeker("quiet", 1000));
      await store.addSeeker(seeker("eager", 2000, 6000));
      const pair = (x: string, y: string, freshAfter: number) =>
        store.pairSeekers({ id: x, grant: grant(x) }, { id: y, grant: grant(y) }, freshAfter);
      expect(await pair("quiet", "eager", 5000)).toBe(false);
      expect(await pair("eager", "missing", 0)).toBe(false);
      expect((await store.waitingSeekers(10)).map((s) => s.id)).toEqual(["quiet", "eager"]);
      expect(await pair("quiet", "eager", 1000)).toBe(true);
    });

    it("marks a removed seeker cancelled but keeps a matched one's seat", async () => {
      const store = makeStore();
      await store.addSeeker(seeker("a", 1000));
      await store.addSeeker(seeker("b", 2000));
      await store.addSeeker(seeker("c", 3000));
      await store.pairSeekers({ id: "a", grant: grant("a") }, { id: "b", grant: grant("b") }, 0);
      expect(await store.removeSeeker("c")).toEqual(seeker("c", 3000));
      expect(await store.touchSeeker("c", 4000)).toEqual(cancelledSeeker("c"));
      expect(await store.removeSeeker("c")).toEqual(cancelledSeeker("c"));
      expect((await store.removeSeeker("a"))?.grant).toEqual(grant("a"));
      expect((await store.touchSeeker("a", 4000))?.grant).toEqual(grant("a"));
      expect(await store.waitingSeekers(10)).toEqual([]);
    });

    it("refuses a known id, and one cancelled before it ever arrived", async () => {
      const store = makeStore();
      expect(await store.addSeeker(seeker("a", 1000))).toBe(true);
      expect(await store.addSeeker(seeker("a", 2000))).toBe(false);
      expect((await store.waitingSeekers(10)).map((s) => s.since)).toEqual([1000]);
      expect(await store.removeSeeker("early")).toBeNull();
      expect(await store.addSeeker(seeker("early", 3000))).toBe(false);
      expect((await store.waitingSeekers(10)).map((s) => s.id)).toEqual(["a"]);
      // A cancelled seeker can be neither paired nor pruned.
      await store.removeSeeker("a");
      await store.addSeeker(seeker("b", 4000));
      const pair = store.pairSeekers(
        { id: "a", grant: grant("a") },
        { id: "b", grant: grant("b") },
        0,
      );
      expect(await pair).toBe(false);
      expect(await store.pruneSeeker("a", 9000)).toBe(false);
      expect(await store.touchSeeker("a", 9000)).toEqual(cancelledSeeker("a"));
    });

    it("prunes a seeker only while they are still waiting and quiet", async () => {
      const store = makeStore();
      await store.addSeeker(seeker("quiet", 1000));
      await store.addSeeker(seeker("renewed", 1000));
      await store.addSeeker(seeker("a", 2000));
      await store.addSeeker(seeker("b", 2000));
      // Heard from after the list that called them stale was read.
      await store.touchSeeker("renewed", 6000);
      expect(await store.pruneSeeker("renewed", 5000)).toBe(false);
      expect(await store.pruneSeeker("quiet", 5000)).toBe(true);
      expect(await store.touchSeeker("quiet", 7000)).toBeNull();
      await store.pairSeekers({ id: "a", grant: grant("a") }, { id: "b", grant: grant("b") }, 0);
      expect(await store.pruneSeeker("a", 5000)).toBe(false);
      expect((await store.touchSeeker("a", 7000))?.grant).toEqual(grant("a"));
      expect((await store.waitingSeekers(10)).map((s) => s.id)).toEqual(["renewed"]);
    });

    it("hands out copies of seekers, never shared references", async () => {
      const store = makeStore();
      const original = seeker("a", 1000);
      await store.addSeeker(original);
      original.name = "changed";
      const listed = await store.waitingSeekers(1);
      if (listed[0]) listed[0].name = "changed again";
      expect((await store.touchSeeker("a", 1000))?.name).toBe("a");
    });

    it("tracks seat connection leases across multiple connections and disconnects", async () => {
      let now = 1000;
      const store = makeStore(() => now);
      expect((await store.getPresence("room-p")).presence).toEqual({
        revision: 0,
        white: { connections: {}, disconnectedAt: null },
        black: { connections: {}, disconnectedAt: null },
      });

      const first = await store.connectSeat("room-p", "white", "c1", 25_000);
      expect(first.changed).toBe(true);
      expect(first.now).toBe(1000);
      expect(first.presence.revision).toBe(1);
      expect(first.presence.white).toEqual({ connections: { c1: 26_000 }, disconnectedAt: null });

      // A second live connection (e.g. socket rotation or second tab) does not flip presence.
      now = 5000;
      const second = await store.connectSeat("room-p", "white", "c2", 25_000);
      expect(second.changed).toBe(false);
      expect(second.presence.revision).toBe(2);
      expect(second.presence.white.connections).toEqual({ c1: 26_000, c2: 30_000 });

      // Closing the first connection while the second stays open leaves the seat online.
      now = 6000;
      const dropOne = await store.disconnectSeat("room-p", "white", "c1");
      expect(dropOne?.changed).toBe(false);
      expect(dropOne?.presence.white).toEqual({
        connections: { c2: 30_000 },
        disconnectedAt: null,
      });

      // Closing the last connection marks the seat disconnected at that instant.
      now = 9000;
      const dropLast = await store.disconnectSeat("room-p", "white", "c2");
      expect(dropLast?.changed).toBe(true);
      expect(dropLast?.presence.white).toEqual({ connections: {}, disconnectedAt: 9000 });

      // Closing again is idempotent and does not shift disconnectedAt.
      now = 12_000;
      const dropAgain = await store.disconnectSeat("room-p", "white", "c2");
      expect(dropAgain?.changed).toBe(false);
      expect(dropAgain?.presence.white.disconnectedAt).toBe(9000);

      // Reconnecting clears disconnectedAt, bumps revision, and flips presence back online.
      now = 15_000;
      const back = await store.connectSeat("room-p", "white", "c3", 25_000);
      expect(back.changed).toBe(true);
      expect(back.presence.revision).toBeGreaterThan(dropLast?.presence.revision ?? 0);
      expect(back.presence.white).toEqual({ connections: { c3: 40_000 }, disconnectedAt: null });
    });

    it("renews live leases without resurrecting closed ones, and pins expired leases", async () => {
      let now = 0;
      const store = makeStore(() => now);
      await store.connectSeat("room-r", "white", "w1", 25_000);
      await store.connectSeat("room-r", "black", "b1", 25_000);

      // Renewing a live connection extends its expiry and reports active: true.
      now = 10_000;
      const renewed = await store.renewSeat("room-r", "white", "w1", 30_000);
      expect(renewed?.active).toBe(true);
      expect(renewed?.presence.white.connections).toEqual({ w1: 40_000 });

      // Once a connection closes, a late renew reports active: false and never resurrects it.
      now = 12_000;
      await store.disconnectSeat("room-r", "white", "w1");
      now = 13_000;
      const lateRenew = await store.renewSeat("room-r", "white", "w1", 30_000);
      expect(lateRenew?.active).toBe(false);
      expect(lateRenew?.presence.white).toEqual({ connections: {}, disconnectedAt: 12_000 });

      // When black's lease expires without a clean close, pruning pins disconnectedAt to its expiry.
      now = 30_000;
      const afterExpiry = (await store.getPresence("room-r")).presence;
      expect(afterExpiry.black).toEqual({ connections: {}, disconnectedAt: 25_000 });
      // Later reads keep disconnectedAt pinned at 25_000 rather than drifting forward.
      now = 45_000;
      expect((await store.getPresence("room-r")).presence.black.disconnectedAt).toBe(25_000);
    });

    it("atomically rejects claimSeat when opponent reconnects or grace has not elapsed, and commits once eligible", async () => {
      let now = 1000;
      const store = makeStore(() => now);
      const started: Room = {
        id: "room-claim",
        code: "CLAIM",
        version: 1,
        seats: {
          white: { token: "w", name: "Ada", presence: true },
          black: { token: "b", name: "Grace", presence: true },
        },
        game: {
          board: { points: [], bar: { white: 0, black: 0 }, off: { white: 0, black: 0 } },
          current: "white",
          dice: [],
          phase: "roll",
          winner: null,
          winReason: null,
          cards: {
            white: { deck: [], hand: [], discard: [], offer: [] },
            black: { deck: [], hand: [], discard: [], offer: [] },
          },
          shielded: { white: false, black: false },
          wins: { white: 0, black: 0 },
          rematch: { white: false, black: false },
          rng: 1,
        },
        gameStartedAt: 1000,
        gameStartedMatch: 0,
      };
      const winning: Room = {
        ...started,
        version: 2,
        game: {
          ...started.game!,
          phase: "over",
          winner: "white",
          winReason: "abandoned",
          wins: { white: 1, black: 0 },
        },
      };
      const timings = {
        claimGraceMs: 30_000,
        arrivalGraceMs: 10_000,
      };
      await store.create(started);
      await store.connectSeat("room-claim", "white", "w1", 25_000);
      await store.connectSeat("room-claim", "black", "b1", 25_000);

      // Connected opponent: rejected atomically without modifying the room.
      expect(await store.claimSeat(winning, 1, "black", timings)).toMatchObject({
        ok: false,
        reason: "online",
      });
      expect((await store.load("CLAIM"))?.version).toBe(1);

      // Opponent disconnects; before 30s -> too_early.
      now = 2000;
      await store.disconnectSeat("room-claim", "black", "b1");
      now = 20_000;
      expect(await store.claimSeat(winning, 1, "black", timings)).toMatchObject({
        ok: false,
        reason: "too_early",
        remainingMs: 12_000,
      });

      // Opponent reconnects right at 32s before claimSeat runs -> rejected as online!
      now = 32_000;
      await store.connectSeat("room-claim", "black", "b2", 25_000);
      expect(await store.claimSeat(winning, 1, "black", timings)).toMatchObject({
        ok: false,
        reason: "online",
      });
      expect((await store.load("CLAIM"))?.version).toBe(1);

      // Opponent disconnects again and stays away past 30s -> wrong expectedVersion conflicts.
      now = 40_000;
      await store.disconnectSeat("room-claim", "black", "b2");
      now = 70_000;
      expect(await store.claimSeat(winning, 0, "black", timings)).toMatchObject({
        ok: false,
        reason: "conflict",
      });

      // Matching version + elapsed grace -> atomically commits winning state.
      const claimed = await store.claimSeat(winning, 1, "black", timings);
      expect(claimed).toMatchObject({ ok: true, now: 70_000 });
      expect((await store.load("CLAIM"))?.version).toBe(2);
      expect((await store.load("CLAIM"))?.game?.winner).toBe("white");
    });

    it("keeps legacy rooms and unmarked seats ineligible for abandonment claims indefinitely", async () => {
      let now = 1000;
      const store = makeStore(() => now);
      const timings = {
        claimGraceMs: 30_000,
        arrivalGraceMs: 10_000,
      };
      const baseGame: NonNullable<Room["game"]> = {
        board: { points: [], bar: { white: 0, black: 0 }, off: { white: 0, black: 0 } },
        current: "white",
        dice: [],
        phase: "roll",
        winner: null,
        winReason: null,
        cards: {
          white: { deck: [], hand: [], discard: [], offer: [] },
          black: { deck: [], hand: [], discard: [], offer: [] },
        },
        shielded: { white: false, black: false },
        wins: { white: 0, black: 0 },
        rematch: { white: false, black: false },
        rng: 1,
      };
      const winFor = (base: Room, winner: "white" | "black"): Room => ({
        ...base,
        version: base.version + 1,
        game: {
          ...baseGame,
          phase: "over",
          winner,
          winReason: "abandoned",
          wins: { white: winner === "white" ? 1 : 0, black: winner === "black" ? 1 : 0 },
        },
      });

      // Case 1: New server created host (`presence: true`), old server handled guest join
      // (so `gameStartedAt` is omitted). Even long past 310s (after old-server rotations),
      // neither seat can be claimed against.
      const mixedJoin: Room = {
        id: "room-mixed-join",
        code: "MIXED",
        version: 1,
        seats: {
          white: { token: "w", name: "Ada", presence: true },
          black: { token: "b", name: "Grace" },
        },
        game: baseGame,
      };
      await store.create(mixedJoin);
      await store.connectSeat("room-mixed-join", "black", "b1", 25_000);
      now = 1_000_000;
      expect(await store.claimSeat(winFor(mixedJoin, "black"), 1, "white", timings)).toMatchObject({
        ok: false,
        reason: "online",
      });

      // Case 2: Legacy host (`presence` omitted), new server joined guest (`gameStartedAt` set).
      // Even if a second tab connects to a new server and closes (setting `disconnectedAt`) and
      // 10+ minutes elapse (covering old-server socket rotations), the unmarked seat stays ineligible.
      now = 1000;
      const secondTab: Room = {
        id: "room-second-tab",
        code: "TAB02",
        version: 1,
        seats: {
          white: { token: "w", name: "Ada" },
          black: { token: "b", name: "Grace", presence: true },
        },
        game: baseGame,
        gameStartedAt: 1000,
        gameStartedMatch: 0,
      };
      await store.create(secondTab);
      await store.connectSeat("room-second-tab", "black", "b1", 25_000);
      now = 2000;
      await store.connectSeat("room-second-tab", "white", "w-tab2", 25_000);
      now = 3000;
      await store.disconnectSeat("room-second-tab", "white", "w-tab2");
      now = 1_000_000;
      expect(await store.claimSeat(winFor(secondTab, "black"), 1, "white", timings)).toMatchObject({
        ok: false,
        reason: "online",
      });

      // Case 3: Rematch started by an old server preserves the previous game's `gameStartedAt`
      // and `gameStartedMatch: 0` even though `wins` now totals 1. A marked player who left on
      // the previous result screen cannot be claimed immediately in the new rematch.
      now = 1000;
      const oldRematch: Room = {
        id: "room-old-rematch",
        code: "RMOLD",
        version: 5,
        seats: {
          white: { token: "w", name: "Ada", presence: true },
          black: { token: "b", name: "Grace", presence: true },
        },
        game: { ...baseGame, wins: { white: 1, black: 0 } },
        gameStartedAt: 1000,
        gameStartedMatch: 0,
      };
      await store.create(oldRematch);
      await store.connectSeat("room-old-rematch", "white", "w1", 25_000);
      await store.connectSeat("room-old-rematch", "black", "b1", 25_000);
      now = 2000;
      await store.disconnectSeat("room-old-rematch", "white", "w1");
      now = 60_000;
      expect(await store.claimSeat(winFor(oldRematch, "black"), 5, "white", timings)).toMatchObject(
        { ok: false, reason: "online" },
      );
    });

    it("hands out copies of presence, never shared references", async () => {
      const store = makeStore(() => 1000);
      await store.connectSeat("room-c", "white", "w1", 25_000);
      const { presence: p } = await store.getPresence("room-c");
      p.white.connections.w1 = 999_999;
      p.white.disconnectedAt = 1234;
      expect((await store.getPresence("room-c")).presence.white).toEqual({
        connections: { w1: 26_000 },
        disconnectedAt: null,
      });
    });
  });
}
