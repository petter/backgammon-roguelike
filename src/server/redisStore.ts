import { Redis } from "ioredis";
import { type GameStore, notify, type Room, type RoomUpdate } from "./store.ts";

const DAY_SECONDS = 24 * 60 * 60;

/** Writes the room only if the stored version is still the expected one. */
const SAVE_IF_VERSION = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if cjson.decode(current).version ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
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

  const listeners = new Map<string, Set<(update: RoomUpdate) => void>>();
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
        const update = JSON.parse(text) as RoomUpdate;
        notify(listeners.get(channel), update);
      } catch (error) {
        console.error("Ignoring a malformed room update", error);
      }
    });
    return subscriber;
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
        SAVE_IF_VERSION,
        1,
        key(room.code),
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
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
      }
      set.add(listener);
      const remove = () => {
        set.delete(listener);
        if (set.size > 0 || listeners.get(channel) !== set) return;
        listeners.delete(channel);
        subscriber?.unsubscribe(channel).catch(() => {});
      };
      try {
        // Idempotent, and resolves only once Redis has confirmed the subscription.
        await subscribing().subscribe(channel);
      } catch (error) {
        // The caller gets no handle to remove the listener with, so remove it here.
        remove();
        throw error;
      }
      return remove;
    },
    async close() {
      await Promise.all([redis.quit(), subscriber?.quit()].map((p) => p?.catch(() => {})));
    },
  };
}
