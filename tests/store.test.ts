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
