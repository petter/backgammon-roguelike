import { afterAll, describe, expect, it } from "vitest";
import { createRedisStore, type RedisStore } from "../src/server/redisStore.ts";
import { createRoom, joinRoom, openConnection } from "../src/server/room.ts";
import { storeContract } from "./storeContract.ts";

// Needs a real Redis: `REDIS_URL=redis://localhost:6379 pnpm test`. Skipped otherwise.
const url = process.env.REDIS_URL;
const stores: RedisStore[] = [];
const open = (ttl?: number) => {
  const store = createRedisStore(url ?? "", ttl);
  stores.push(store);
  return store;
};
afterAll(async () => {
  await Promise.all(stores.map((store) => store.close()));
});

/** Room codes are fixed in the contract; a prefix per run keeps runs from colliding. */
function isolated(store: RedisStore, prefix: string): RedisStore {
  const tag = (code: string) => `${prefix}${code}`;
  const strip = (code: string) => code.slice(prefix.length);
  return {
    create: (room) => store.create({ ...room, code: tag(room.code) }),
    load: async (code) => {
      const room = await store.load(tag(code));
      return room && { ...room, code: strip(room.code) };
    },
    save: (room, expected) => store.save({ ...room, code: tag(room.code) }, expected),
    publish: (code, update) =>
      store.publish(tag(code), {
        ...update,
        room: { ...update.room, code: tag(update.room.code) },
      }),
    subscribe: (code, listener) =>
      store.subscribe(tag(code), (update) =>
        listener({ ...update, room: { ...update.room, code: strip(update.room.code) } }),
      ),
    close: () => store.close(),
  };
}

describe.skipIf(!url)("redis", () => {
  let run = 0;
  // Pub/sub is asynchronous in Redis: give deliveries a moment before the contract asserts.
  const settled = (store: RedisStore): RedisStore => ({
    ...store,
    publish: async (code, update) => {
      await store.publish(code, update);
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
  });
  storeContract("redis", () => settled(isolated(open(), `t${Date.now()}-${run++}-`)));

  it("expires a room after its time to live", async () => {
    const store = open(1);
    const code = `x${Date.now()}`;
    await store.create({ code, version: 0, seats: {}, game: null });
    expect(await store.load(code)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(await store.load(code)).toBeNull();
  });

  it("carries a game between two separate server instances", async () => {
    const instanceA = open();
    const instanceB = open();
    const host = await createRoom(instanceA, "Ada");
    const guest = await joinRoom(instanceB, host.code, "Grace");
    const seenA: number[] = [];
    const seenB: number[] = [];
    const a = await openConnection(instanceA, host.code, host.token, (m) => {
      if (m.type === "state") seenA.push(m.version);
    });
    const b = await openConnection(instanceB, host.code, guest.token, (m) => {
      if (m.type === "state") seenB.push(m.version);
    });
    const first = (await instanceA.load(host.code))?.game?.current;
    await (first === "white" ? a : b).command({ type: "pickCard", index: 0 });
    await (first === "white" ? a : b).command({ type: "roll" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seenA).toEqual([1, 2, 3]);
    expect(seenB).toEqual([1, 2, 3]);
    a.close();
    b.close();
  });
});
