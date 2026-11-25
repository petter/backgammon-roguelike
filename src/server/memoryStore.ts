import {
  cancelledSeeker,
  emptyPresence,
  type GameStore,
  Listeners,
  opponentAwaySince,
  type PresenceUpdate,
  type Room,
  type RoomPresence,
  type SeatPresence,
  SEEKER_TTL_SECONDS,
  type Seeker,
} from "./store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Drops expired leases from a seat. If the last live lease expired without a clean close,
 * pins `disconnectedAt` to when that lease ran out so the countdown does not drift.
 */
function pruneSeat(seat: SeatPresence, now: number): { live: number; expired: boolean } {
  let live = 0;
  let latestExpired: number | null = null;
  for (const [id, exp] of Object.entries(seat.connections)) {
    if (exp > now) {
      live++;
    } else {
      delete seat.connections[id];
      if (latestExpired === null || exp > latestExpired) latestExpired = exp;
    }
  }
  const expired = latestExpired !== null;
  if (live > 0) {
    seat.disconnectedAt = null;
  } else if (expired && seat.disconnectedAt === null) {
    seat.disconnectedAt = latestExpired;
  }
  return { live, expired };
}

/**
 * In-process store. Values are cloned on the way in and out, so callers cannot share
 * references through it, just as they could not through a real database.
 */
export function createMemoryStore(ttlMs = DAY_MS, now: () => number = Date.now): GameStore {
  const rooms = new Map<string, { room: Room; expires: number }>();
  const presences = new Map<string, { presence: RoomPresence; expires: number }>();
  let nextPresenceSweep = Number.POSITIVE_INFINITY;
  const listeners = new Listeners();
  const presenceListeners = new Listeners<PresenceUpdate>();
  const seekers = new Map<string, { seeker: Seeker; expires: number }>();
  /** Open tabs by id: when each was last heard from, and whether it is searching. */
  const visitors = new Map<string, { seen: number; searching: boolean }>();

  const live = (code: string): Room | null => {
    const entry = rooms.get(code);
    if (!entry) return null;
    if (entry.expires > now()) return entry.room;
    rooms.delete(code);
    return null;
  };
  const put = (room: Room) => {
    rooms.set(room.code, { room: structuredClone(room), expires: now() + ttlMs });
  };

  /** Removes expired presence records without waiting for those unique room ids to be read again. */
  const sweepPresences = (at: number) => {
    if (at < nextPresenceSweep) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const [id, entry] of presences) {
      if (entry.expires <= at) presences.delete(id);
      else if (entry.expires < earliest) earliest = entry.expires;
    }
    nextPresenceSweep = earliest;
  };
  const livePresence = (roomId: string, at: number): RoomPresence | null => {
    sweepPresences(at);
    const entry = presences.get(roomId);
    if (!entry) return null;
    if (entry.expires > at) return entry.presence;
    presences.delete(roomId);
    return null;
  };
  const putPresence = (roomId: string, presence: RoomPresence, at: number) => {
    sweepPresences(at);
    const expires = at + ttlMs;
    presences.set(roomId, { presence: structuredClone(presence), expires });
    if (expires < nextPresenceSweep) nextPresenceSweep = expires;
  };

  const seeker = (id: string): Seeker | null => {
    const entry = seekers.get(id);
    if (!entry) return null;
    if (entry.expires > now()) return entry.seeker;
    seekers.delete(id);
    return null;
  };
  const keep = (value: Seeker) => {
    seekers.set(value.id, {
      seeker: structuredClone(value),
      expires: now() + SEEKER_TTL_SECONDS * 1000,
    });
  };
  const waiting = (id: string): Seeker | null => {
    const found = seeker(id);
    return found && !found.grant && !found.cancelled ? found : null;
  };

  return {
    async create(room) {
      if (live(room.code)) return false;
      put(room);
      return true;
    },
    async load(code) {
      const room = live(code);
      return room ? structuredClone(room) : null;
    },
    async save(room, expectedVersion) {
      const current = live(room.code);
      if (current?.id !== room.id || current.version !== expectedVersion) return false;
      put(room);
      return true;
    },
    async publish(code, update) {
      listeners.notify(code, update);
    },
    async subscribe(code, listener) {
      return listeners.add(code, listener);
    },
    async publishPresence(roomId, update) {
      presenceListeners.notify(roomId, update);
    },
    async subscribePresence(roomId, listener) {
      return presenceListeners.add(roomId, listener);
    },
    async clock() {
      return now();
    },
    async connectSeat(roomId, seat, connId, leaseMs) {
      const at = now();
      const current = structuredClone(livePresence(roomId, at) ?? emptyPresence());
      const white = pruneSeat(current.white, at);
      const black = pruneSeat(current.black, at);
      const wasOnline = (seat === "white" ? white.live : black.live) > 0;
      current[seat].connections[connId] = at + leaseMs;
      current[seat].disconnectedAt = null;
      current.revision++;
      putPresence(roomId, current, at);
      return { presence: structuredClone(current), changed: !wasOnline, now: at };
    },
    async renewSeat(roomId, seat, connId, leaseMs) {
      const at = now();
      const found = livePresence(roomId, at);
      if (!found) return null;
      const current = structuredClone(found);
      const white = pruneSeat(current.white, at);
      const black = pruneSeat(current.black, at);
      const active = Object.hasOwn(current[seat].connections, connId);
      const dirty = white.expired || black.expired;
      if (active) {
        current[seat].connections[connId] = at + leaseMs;
        current[seat].disconnectedAt = null;
      }
      if (dirty) current.revision++;
      if (active || dirty) putPresence(roomId, current, at);
      return { presence: structuredClone(current), active, now: at };
    },
    async disconnectSeat(roomId, seat, connId) {
      const at = now();
      const found = livePresence(roomId, at);
      if (!found) return null;
      const current = structuredClone(found);
      const wasDisconnected = current[seat].disconnectedAt !== null;
      const white = pruneSeat(current.white, at);
      const black = pruneSeat(current.black, at);
      const wasLive = seat === "white" ? white.live : black.live;
      const hadConn = Object.hasOwn(current[seat].connections, connId);
      let remaining = wasLive;
      if (hadConn) {
        delete current[seat].connections[connId];
        remaining = wasLive - 1;
        if (remaining === 0) current[seat].disconnectedAt = at;
      }
      if (hadConn || white.expired || black.expired) {
        current.revision++;
        putPresence(roomId, current, at);
      }
      const isDisconnected = remaining === 0 && current[seat].disconnectedAt !== null;
      return {
        presence: structuredClone(current),
        changed: !wasDisconnected && isDisconnected,
        now: at,
      };
    },
    async getPresence(roomId) {
      const at = now();
      const found = livePresence(roomId, at);
      if (!found) {
        return { presence: emptyPresence(), now: at };
      }
      const current = structuredClone(found);
      const white = pruneSeat(current.white, at);
      const black = pruneSeat(current.black, at);
      if (white.expired || black.expired) {
        current.revision++;
        putPresence(roomId, current, at);
      }
      return { presence: structuredClone(current), now: at };
    },
    async claimSeat(room, expectedVersion, other, timings) {
      const at = now();
      const stored = live(room.code);
      if (stored?.id !== room.id || stored.version !== expectedVersion) {
        return { ok: false, reason: "conflict", now: at };
      }
      const current = structuredClone(livePresence(room.id, at) ?? emptyPresence());
      const white = pruneSeat(current.white, at);
      const black = pruneSeat(current.black, at);
      if (white.expired || black.expired) {
        current.revision++;
        putPresence(room.id, current, at);
      }
      const awaySince = opponentAwaySince(stored, current, other, at, timings);
      if (awaySince === null) {
        return { ok: false, reason: "online", presence: structuredClone(current), now: at };
      }
      const remainingMs = timings.claimGraceMs - (at - awaySince);
      if (remainingMs > 0) {
        return {
          ok: false,
          reason: "too_early",
          remainingMs,
          presence: structuredClone(current),
          now: at,
        };
      }
      put(room);
      return { ok: true, presence: structuredClone(current), now: at };
    },
    async addSeeker(value) {
      if (seeker(value.id)) return false;
      keep(value);
      return true;
    },
    async touchSeeker(id, at) {
      const found = seeker(id);
      if (!found) return null;
      if (found.grant || found.cancelled) return structuredClone(found);
      const touched = { ...found, seen: at };
      keep(touched);
      return structuredClone(touched);
    },
    async waitingSeekers(limit) {
      return Array.from(seekers.keys())
        .flatMap((id) => waiting(id) ?? [])
        .toSorted((x, y) => x.since - y.since)
        .slice(0, limit)
        .map((found) => structuredClone(found));
    },
    async pairSeekers(a, b, freshAfter) {
      const first = waiting(a.id);
      const second = waiting(b.id);
      if (!first || !second || first === second) return false;
      if (first.seen < freshAfter || second.seen < freshAfter) return false;
      keep({ ...first, grant: a.grant });
      keep({ ...second, grant: b.grant });
      return true;
    },
    async pruneSeeker(id, seenBefore) {
      const found = waiting(id);
      if (!found || found.seen >= seenBefore) return false;
      seekers.delete(id);
      return true;
    },
    async removeSeeker(id) {
      const found = seeker(id);
      if (!found?.grant) keep(cancelledSeeker(id));
      return found && structuredClone(found);
    },
    async pulse(id, searching, windowMs) {
      const at = now();
      for (const [other, entry] of visitors) {
        if (entry.seen <= at - windowMs) visitors.delete(other);
      }
      visitors.set(id, { seen: at, searching });
      let looking = 0;
      for (const entry of visitors.values()) if (entry.searching) looking++;
      return { online: visitors.size, searching: looking };
    },
    async leave(id) {
      visitors.delete(id);
    },
  };
}
