import { Redis } from "ioredis";
import { type GameStore, Listeners, type Room, type RoomUpdate } from "./store.ts";

const DAY_SECONDS = 24 * 60 * 60;

/** Writes the room only if the stored one is the same room, still at the expected version. */
const SAVE_IF_UNCHANGED = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local room = cjson.decode(current)
if room.id ~= ARGV[1] or room.version ~= tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
return 1
`;

const key = (code: string) => `room:${code}`;

export interface RedisStore extends GameStore {
  /** Closes both connections. For tests and scripts; a server keeps them for its lifetime. */
  close(): Promise<void>;
}

/**
 * Rooms in Redis, shared by every server instance. Each room is one JSON value that expires
 * a day after its last write; changes are announced on a pub/sub channel per room.
 */
export function createRedisStore(url: string, ttlSeconds = DAY_SECONDS): RedisStore {
  const redis = new Redis(url, { maxRetriesPerRequest: 3 });
  redis.on("error", (error) => console.error("Redis error", error.message));

  const listeners = new Listeners();
  let subscriber: Redis | null = null;
  // A connection in subscribe mode can do nothing else, so it gets its own. One per
  // instance serves every room; ioredis resubscribes by itself after a reconnect.
  const subscribing = (): Redis => {
    if (subscriber) return subscriber;
    subscriber = redis.duplicate();
    subscriber.on("error", (error) => console.error("Redis subscriber error", error.message));
    subscriber.on("message", (channel: string, text: string) => {
      // Nothing thrown here may escape: it would take the whole process down with it.
      try {
        listeners.notify(channel, JSON.parse(text) as RoomUpdate);
      } catch (error) {
        console.error("Ignoring a malformed room update", error);
      }
    });
    return subscriber;
  };

  // Channels Redis may still have us subscribed to although nobody listens any more,
  // because an UNSUBSCRIBE failed. Retried whenever subscriptions next change.
  const leftover = new Set<string>();
  /** Channels with an UNSUBSCRIBE on its way, so a retry is never stacked on another. */
  const releasing = new Set<string>();
  const release = (channel: string) => {
    leftover.add(channel);
    for (const stale of [...leftover]) {
      if (listeners.has(stale)) {
        leftover.delete(stale);
        continue;
      }
      if (releasing.has(stale) || !subscriber) continue;
      releasing.add(stale);
      subscriber
        .unsubscribe(stale)
        // Someone may have subscribed again while this was in flight; then it stays.
        .then(() => !listeners.has(stale) && leftover.delete(stale))
        .catch((error) => console.error("Could not unsubscribe from a room", error.message))
        .finally(() => releasing.delete(stale));
    }
  };

  return {
    async create(room) {
      const set = await redis.set(key(room.code), JSON.stringify(room), "EX", ttlSeconds, "NX");
      return set === "OK";
    },
    async load(code) {
      const text = await redis.get(key(code));
      return text ? (JSON.parse(text) as Room) : null;
    },
    async save(room, expectedVersion) {
      const saved = await redis.eval(
        SAVE_IF_UNCHANGED,
        1,
        key(room.code),
        room.id,
        expectedVersion,
        JSON.stringify(room),
        ttlSeconds,
      );
      return saved === 1;
    },
    async publish(code, update) {
      await redis.publish(key(code), JSON.stringify(update));
    },
    async subscribe(code, listener) {
      const channel = key(code);
      // Registered before Redis confirms, so nothing published in between can be missed.
      const remove = listeners.add(channel, listener);
      const stop = () => {
        if (remove()) release(channel);
      };
      try {
        // Idempotent, and resolves only once Redis has confirmed the subscription.
        await subscribing().subscribe(channel);
      } catch (error) {
        // The caller gets no handle to remove the listener with, so remove it here.
        stop();
        throw error;
      }
      return stop;
    },
    async close() {
      await Promise.all([redis.quit(), subscriber?.quit()].map((p) => p?.catch(() => {})));
    },
  };
}
