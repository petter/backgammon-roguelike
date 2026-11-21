import { type GameStore, Listeners, type Room, SEEKER_TTL_SECONDS, type Seeker } from "./store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * In-process store. Values are cloned on the way in and out, so callers cannot share
 * references through it, just as they could not through a real database.
 */
export function createMemoryStore(ttlMs = DAY_MS, now: () => number = Date.now): GameStore {
  const rooms = new Map<string, { room: Room; expires: number }>();
  const listeners = new Listeners();
  const seekers = new Map<string, { seeker: Seeker; expires: number }>();

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
    return found && !found.grant ? found : null;
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
    async addSeeker(value) {
      keep(value);
    },
    async touchSeeker(id, at) {
      const found = seeker(id);
      if (!found) return null;
      if (found.grant) return structuredClone(found);
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
      if (found && !found.grant) seekers.delete(id);
      return found && structuredClone(found);
    },
  };
}
