import { describe, expect, it } from "vitest";

import type { GameStore, Room, RoomUpdate, Seeker } from "../src/server/store.ts";

function room(code: string, version = 0, id = "room-1"): Room {
  return { id, code, version, seats: { white: { token: "t", name: "Ada" } }, game: null };
}

function seeker(id: string, since: number, seen = since): Seeker {
  return { id, name: id, character: "gambler", since, seen };
}

const grant = (token: string) => ({ code: "AAAAA", token });

/** Behaviour every `GameStore` must share. Run it against each implementation. */
export function storeContract(name: string, makeStore: () => GameStore): void {
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

    it("forgets a removed waiting seeker but keeps a matched one's seat", async () => {
      const store = makeStore();
      await store.addSeeker(seeker("a", 1000));
      await store.addSeeker(seeker("b", 2000));
      await store.addSeeker(seeker("c", 3000));
      await store.pairSeekers({ id: "a", grant: grant("a") }, { id: "b", grant: grant("b") }, 0);
      expect(await store.removeSeeker("c")).toEqual(seeker("c", 3000));
      expect(await store.touchSeeker("c", 4000)).toBeNull();
      expect(await store.removeSeeker("c")).toBeNull();
      expect((await store.removeSeeker("a"))?.grant).toEqual(grant("a"));
      expect((await store.touchSeeker("a", 4000))?.grant).toEqual(grant("a"));
      expect(await store.waitingSeekers(10)).toEqual([]);
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
  });
}
