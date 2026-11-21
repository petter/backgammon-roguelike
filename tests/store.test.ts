import { describe, expect, it } from "vitest";

import { createMemoryStore } from "../src/server/memoryStore.ts";
import { storeContract } from "./storeContract.ts";

storeContract("memory", () => createMemoryStore());

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
