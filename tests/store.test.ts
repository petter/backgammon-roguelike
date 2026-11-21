import { describe, expect, it } from "vitest";

import { createMemoryStore } from "../src/server/memoryStore.ts";
import { storeContract } from "./storeContract.ts";

storeContract("memory", (now) => createMemoryStore(undefined, now));

describe("memory store expiry", () => {
  it("forgets a room after its time to live, counted from the last write", async () => {
    let now = 0;
    const store = createMemoryStore(1000, () => now);
    const room = { id: "r1", code: "AAAAA", version: 0, seats: {}, game: null };
    await store.create(room);
    now = 900;
    expect(await store.save({ ...room, version: 1 }, 0)).toBe(true);
    now = 1800;
    expect(await store.load("AAAAA")).not.toBeNull();
    now = 1900;
    expect(await store.load("AAAAA")).toBeNull();
    expect(await store.save({ ...room, version: 2 }, 1)).toBe(false);
    expect(await store.create(room)).toBe(true);
  });

  it("sweeps expired presence records without waiting for those abandoned room ids to be read again", async () => {
    let now = 0;
    const store = createMemoryStore(1000, () => now);
    await store.connectSeat("abandoned-room", "white", "c1", 25_000);
    // Advance past TTL and touch an unrelated room: the sweep must evict `abandoned-room`.
    now = 2000;
    await store.connectSeat("active-room", "white", "c2", 25_000);
    // Rewinding the clock proves the entry was actually deleted, not merely skipped on read.
    now = 500;
    expect((await store.getPresence("abandoned-room")).presence).toEqual({
      revision: 0,
      white: { connections: {}, disconnectedAt: null },
      black: { connections: {}, disconnectedAt: null },
    });
  });
});

describe("memory store seekers", () => {
  it("forgets a seeker ten minutes after they were last heard from", async () => {
    let now = 0;
    const store = createMemoryStore(1000, () => now);
    await store.addSeeker({ id: "a", name: "Ada", character: "gambler", since: 0, seen: 0 });
    now = 9 * 60_000;
    expect(await store.touchSeeker("a", now)).not.toBeNull();
    now = 18 * 60_000;
    expect((await store.waitingSeekers(10)).map((s) => s.id)).toEqual(["a"]);
    now = 20 * 60_000;
    expect(await store.waitingSeekers(10)).toEqual([]);
    expect(await store.touchSeeker("a", now)).toBeNull();
  });
});
