import { Redis } from "ioredis";

import {
  CLAIM_SEAT,
  CONNECT_SEAT,
  DISCONNECT_SEAT,
  GET_PRESENCE,
  RENEW_SEAT,
} from "./redisPresenceScripts.ts";
import {
  cancelledSeeker,
  type ClaimOutcome,
  type GameStore,
  Listeners,
  type PresenceUpdate,
  type Room,
  type RoomPresence,
  type RoomUpdate,
  type SeatPresence,
  SEEKER_TTL_SECONDS,
  type Seeker,
} from "./store.ts";

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

/**
 * Moves a waiting seeker's `seen` forward, and makes sure they are still in the queue.
 * Returns the record, or nothing if it is gone.
 */
const TOUCH_SEEKER = `
local text = redis.call('GET', KEYS[1])
if not text then return false end
local seeker = cjson.decode(text)
if seeker.grant == nil and seeker.cancelled == nil then
  seeker.seen = tonumber(ARGV[1])
  text = cjson.encode(seeker)
  redis.call('SET', KEYS[1], text, 'EX', ARGV[2])
  redis.call('ZADD', KEYS[2], 'NX', seeker.since, seeker.id)
end
return text
`;

/** Forgets a seeker only if they are still waiting and were last seen before ARGV[2]. */
const PRUNE_SEEKER = `
local text = redis.call('GET', KEYS[1])
if not text then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 1
end
local seeker = cjson.decode(text)
if seeker.grant ~= nil or seeker.cancelled ~= nil then return 0 end
if seeker.seen >= tonumber(ARGV[2]) then return 0 end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

/** Matches two seekers if both are still waiting and were seen lately; all or nothing. */
const PAIR_SEEKERS = `
if KEYS[1] == KEYS[2] then return 0 end
local first = redis.call('GET', KEYS[1])
local second = redis.call('GET', KEYS[2])
if not first or not second then return 0 end
first = cjson.decode(first)
second = cjson.decode(second)
local fresh = tonumber(ARGV[3])
if first.grant ~= nil or second.grant ~= nil then return 0 end
if first.cancelled ~= nil or second.cancelled ~= nil then return 0 end
if first.seen < fresh or second.seen < fresh then return 0 end
first.grant = cjson.decode(ARGV[1])
second.grant = cjson.decode(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(first), 'EX', ARGV[4])
redis.call('SET', KEYS[2], cjson.encode(second), 'EX', ARGV[4])
redis.call('ZREM', KEYS[3], first.id, second.id)
return 1
`;

/** Takes a seeker out of the queue and leaves a cancelled marker, unless they were matched. */
const REMOVE_SEEKER = `
redis.call('ZREM', KEYS[2], ARGV[1])
local text = redis.call('GET', KEYS[1])
if text and cjson.decode(text).grant ~= nil then return text end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return text or false
`;

/** Starts a seeker waiting, unless the id is already known. */
const ADD_SEEKER = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) == false then return 0 end
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
return 1
`;

const key = (code: string) => `room:${code}`;
const presenceKey = (roomId: string) => `presence:${roomId}`;
const seekerKey = (id: string) => `seeker:${id}`;

function normalizeSeat(raw: Partial<SeatPresence> | undefined): SeatPresence {
  const connections = raw?.connections && !Array.isArray(raw.connections) ? raw.connections : {};
  const disconnectedAt = typeof raw?.disconnectedAt === "number" ? raw.disconnectedAt : null;
  return { connections, disconnectedAt };
}

function decodePresence(text: string): RoomPresence {
  const parsed = JSON.parse(text) as Partial<RoomPresence>;
  return {
    revision: typeof parsed.revision === "number" ? parsed.revision : 0,
    white: normalizeSeat(parsed.white),
    black: normalizeSeat(parsed.black),
  };
}

/**
 * Waiting seekers' ids, scored by when they started looking. It never expires: an id whose
 * record has run out is dropped when the queue is next read.
 */
const QUEUE = "seekers";

export interface RedisStoreOptions {
  /** Put before every key, so tests sharing one Redis cannot see each other's data. */
  keyPrefix?: string;
  /** Optional clock override for deterministic tests; production uses Redis's own `TIME`. */
  now?: () => number;
}

export interface RedisStore extends GameStore {
  /** Closes both connections. For tests and scripts; a server keeps them for its lifetime. */
  close: () => Promise<void>;
}

/**
 * Rooms in Redis, shared by every server instance. Each room is one JSON value that expires
 * a day after its last write; changes are announced on a pub/sub channel per room.
 */
export function createRedisStore(
  url: string,
  ttlSeconds = DAY_SECONDS,
  options: RedisStoreOptions = {},
): RedisStore {
  // Prefixes keys only: pub/sub channels are not keys, so rooms are kept apart by code.
  const redis = new Redis(url, { maxRetriesPerRequest: 3, keyPrefix: options.keyPrefix });
  redis.on("error", (error) => console.error("Redis error", error.message));

  const listeners = new Listeners();
  const presenceListeners = new Listeners<PresenceUpdate>();
  const hasListeners = (channel: string) =>
    listeners.has(channel) || presenceListeners.has(channel);
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
        if (channel.startsWith("presence:")) {
          presenceListeners.notify(channel, JSON.parse(text) as PresenceUpdate);
        } else {
          listeners.notify(channel, JSON.parse(text) as RoomUpdate);
        }
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
    for (const stale of Array.from(leftover)) {
      if (hasListeners(stale)) {
        leftover.delete(stale);
        continue;
      }
      if (releasing.has(stale) || !subscriber) continue;
      releasing.add(stale);
      subscriber
        .unsubscribe(stale)
        // Someone may have subscribed again while this was in flight; then it stays.
        .then(() => !hasListeners(stale) && leftover.delete(stale))
        .catch((error: unknown) =>
          console.error("Could not unsubscribe from a room", (error as Error).message),
        )
        .finally(() => releasing.delete(stale));
    }
  };
  const subscribeChannel = async <T>(
    bag: Listeners<T>,
    channel: string,
    listener: (update: T) => void,
  ): Promise<() => void> => {
    // Registered before Redis confirms, so nothing published in between can be missed.
    const remove = bag.add(channel, listener);
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
  };

  const nowArg = () => (options.now ? String(options.now()) : "");

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
      return subscribeChannel(listeners, key(code), listener);
    },
    async publishPresence(roomId, update) {
      await redis.publish(presenceKey(roomId), JSON.stringify(update));
    },
    async subscribePresence(roomId, listener) {
      return subscribeChannel(presenceListeners, presenceKey(roomId), listener);
    },
    async clock() {
      if (options.now) return options.now();
      const [sec, usec] = await redis.time();
      return Number(sec) * 1000 + Math.floor(Number(usec) / 1000);
    },
    async connectSeat(roomId, seat, connId, leaseMs) {
      const reply = (await redis.eval(
        CONNECT_SEAT,
        1,
        presenceKey(roomId),
        seat,
        connId,
        leaseMs,
        ttlSeconds,
        nowArg(),
      )) as [string, number, number];
      return { presence: decodePresence(reply[0]), changed: reply[1] === 1, now: reply[2] };
    },
    async renewSeat(roomId, seat, connId, leaseMs) {
      const reply = (await redis.eval(
        RENEW_SEAT,
        1,
        presenceKey(roomId),
        seat,
        connId,
        leaseMs,
        ttlSeconds,
        nowArg(),
      )) as [string, number, number] | null;
      return reply
        ? { presence: decodePresence(reply[0]), active: reply[1] === 1, now: reply[2] }
        : null;
    },
    async disconnectSeat(roomId, seat, connId) {
      const reply = (await redis.eval(
        DISCONNECT_SEAT,
        1,
        presenceKey(roomId),
        seat,
        connId,
        ttlSeconds,
        nowArg(),
      )) as [string, number, number] | null;
      return reply
        ? { presence: decodePresence(reply[0]), changed: reply[1] === 1, now: reply[2] }
        : null;
    },
    async getPresence(roomId) {
      const reply = (await redis.eval(
        GET_PRESENCE,
        1,
        presenceKey(roomId),
        ttlSeconds,
        nowArg(),
      )) as [string, number];
      return { presence: decodePresence(reply[0]), now: reply[1] };
    },
    async claimSeat(room, expectedVersion, opponent, timings): Promise<ClaimOutcome> {
      const reply = (await redis.eval(
        CLAIM_SEAT,
        2,
        key(room.code),
        presenceKey(room.id),
        room.id,
        expectedVersion,
        JSON.stringify(room),
        opponent,
        timings.claimGraceMs,
        timings.arrivalGraceMs,
        ttlSeconds,
        nowArg(),
      )) as [string, number, string?, number?];
      const [status, at, pText, remaining] = reply;
      if (status === "ok" && pText) {
        return { ok: true, presence: decodePresence(pText), now: at };
      }
      if (status === "too_early" && pText) {
        return {
          ok: false,
          reason: "too_early",
          remainingMs: remaining ?? 0,
          presence: decodePresence(pText),
          now: at,
        };
      }
      if (status === "online" && pText) {
        return { ok: false, reason: "online", presence: decodePresence(pText), now: at };
      }
      return { ok: false, reason: "conflict", now: at };
    },
    async addSeeker(seeker) {
      const added = await redis.eval(
        ADD_SEEKER,
        2,
        seekerKey(seeker.id),
        QUEUE,
        JSON.stringify(seeker),
        SEEKER_TTL_SECONDS,
        seeker.since,
        seeker.id,
      );
      return added === 1;
    },
    async touchSeeker(id, now) {
      const text = await redis.eval(TOUCH_SEEKER, 2, seekerKey(id), QUEUE, now, SEEKER_TTL_SECONDS);
      return typeof text === "string" ? (JSON.parse(text) as Seeker) : null;
    },
    async waitingSeekers(limit) {
      const ids = await redis.zrange(QUEUE, "0", String(limit - 1));
      if (ids.length === 0) return [];
      const texts = await redis.mget(ids.map(seekerKey));
      // Seekers whose records ran out without being removed are dropped from the queue.
      const expired = ids.filter((_, index) => !texts[index]);
      if (expired.length > 0) await redis.zrem(QUEUE, ...expired);
      return texts
        .flatMap((text) => (text ? [JSON.parse(text) as Seeker] : []))
        .filter((seeker) => !seeker.grant && !seeker.cancelled);
    },
    async pairSeekers(a, b, freshAfter) {
      const paired = await redis.eval(
        PAIR_SEEKERS,
        3,
        seekerKey(a.id),
        seekerKey(b.id),
        QUEUE,
        JSON.stringify(a.grant),
        JSON.stringify(b.grant),
        freshAfter,
        SEEKER_TTL_SECONDS,
      );
      return paired === 1;
    },
    async pruneSeeker(id, seenBefore) {
      return (await redis.eval(PRUNE_SEEKER, 2, seekerKey(id), QUEUE, id, seenBefore)) === 1;
    },
    async removeSeeker(id) {
      const text = await redis.eval(
        REMOVE_SEEKER,
        2,
        seekerKey(id),
        QUEUE,
        id,
        JSON.stringify(cancelledSeeker(id)),
        SEEKER_TTL_SECONDS,
      );
      return typeof text === "string" ? (JSON.parse(text) as Seeker) : null;
    },
    async close() {
      const quits = subscriber ? [redis.quit(), subscriber.quit()] : [redis.quit()];
      await Promise.all(quits.map((p) => p.catch(() => {})));
    },
  };
}
