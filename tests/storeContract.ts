import { describe, expect, it } from "vitest";
import type { GameStore, Room, RoomUpdate } from "../src/server/store.ts";

function room(code: string, version = 0, id = "room-1"): Room {
  return { id, code, version, seats: { white: { token: "t", name: "Ada" } }, game: null };
}

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
  });
}
