import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

import { createRedisStore, type RedisStore } from "../src/server/redisStore.ts";
import { createRoom, joinRoom, openConnection } from "../src/server/room.ts";
import { storeContract } from "./storeContract.ts";

// Needs a real Redis: `REDIS_URL=redis://localhost:6379 pnpm test`. Skipped otherwise.
const url = process.env.REDIS_URL;
const stores: RedisStore[] = [];
const open = (ttl?: number, keyPrefix?: string) => {
  const store = createRedisStore(url ?? "", ttl, { keyPrefix });
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
    // Seekers are kept apart by the store's own key prefix.
    addSeeker: (seeker) => store.addSeeker(seeker),
    touchSeeker: (id, now) => store.touchSeeker(id, now),
    waitingSeekers: (limit) => store.waitingSeekers(limit),
    pairSeekers: (a, b, freshAfter) => store.pairSeekers(a, b, freshAfter),
    pruneSeeker: (id, seenBefore) => store.pruneSeeker(id, seenBefore),
    removeSeeker: (id) => store.removeSeeker(id),
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
  storeContract("redis", () => {
    const prefix = `t${Date.now()}-${run++}-`;
    return settled(isolated(open(undefined, `${prefix}:`), prefix));
  });

  it("keeps a seeker who keeps asking in the queue, however long nobody else arrives", async () => {
    const prefix = `q${Date.now()}:`;
    const store = open(undefined, prefix);
    const admin = new Redis(url ?? "");
    const now = Date.now();
    await store.addSeeker({ id: "a", name: "A", character: "gambler", since: now, seen: now });
    // The queue is an index that must not run out while its seekers are still there.
    expect(await admin.pttl(`${prefix}seekers`)).toBe(-1);
    // Even if the index lost the entry, the next touch puts it back.
    await admin.del(`${prefix}seekers`);
    await store.touchSeeker("a", now + 1000);
    expect((await store.waitingSeekers(10)).map((s) => s.id)).toEqual(["a"]);
    await admin.quit();
  });

  it("expires a room after its time to live", async () => {
    const store = open(1);
    const code = `x${Date.now()}`;
    await store.create({ id: "x", code, version: 0, seats: {}, game: null });
    expect(await store.load(code)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(await store.load(code)).toBeNull();
  });

  it("registers no listener when Redis refuses the subscription", async () => {
    const admin = new Redis(url ?? "");
    const store = open();
    const code = `s${Date.now()}`;
    const ghost: number[] = [];
    try {
      await admin.call("ACL", "SETUSER", "default", "-subscribe");
      await expect(store.subscribe(code, (u) => ghost.push(u.room.version))).rejects.toThrow();
    } finally {
      await admin.call("ACL", "SETUSER", "default", "+subscribe");
    }
    const healthy: number[] = [];
    await store.subscribe(code, (u) => healthy.push(u.room.version));
    await store.publish(code, {
      room: { id: "x", code, version: 2, seats: {}, game: null },
      events: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(healthy).toEqual([2]);
    expect(ghost).toEqual([]);
    await admin.quit();
  });

  it("retries an unsubscribe that Redis refused, the next time subscriptions change", async () => {
    const admin = new Redis(url ?? "");
    const store = open();
    const code = `u${Date.now()}`;
    const subscribers = async () => {
      const reply = (await admin.call("PUBSUB", "NUMSUB", `room:${code}`)) as [string, number];
      return reply[1];
    };
    const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
    const stop = await store.subscribe(code, () => {});
    expect(await subscribers()).toBe(1);
    try {
      await admin.call("ACL", "SETUSER", "default", "-unsubscribe");
      stop();
      await pause();
      expect(await subscribers()).toBe(1);
    } finally {
      await admin.call("ACL", "SETUSER", "default", "+unsubscribe");
    }
    // Unrelated activity is enough to trigger the retry.
    (await store.subscribe(`${code}-other`, () => {}))();
    await pause();
    expect(await subscribers()).toBe(0);

    // A channel that gained a listener again in the meantime is left subscribed.
    const again: number[] = [];
    const stopAgain = await store.subscribe(code, (u) => again.push(u.room.version));
    (await store.subscribe(`${code}-third`, () => {}))();
    await pause();
    await store.publish(code, {
      room: { id: "x", code, version: 7, seats: {}, game: null },
      events: [],
    });
    await pause();
    expect(again).toEqual([7]);
    stopAgain();
    await admin.quit();
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
