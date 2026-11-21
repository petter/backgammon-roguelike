import { type GameStore, Listeners, type Room } from "./store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * In-process store. Values are cloned on the way in and out, so callers cannot share
 * references through it, just as they could not through a real database.
 */
export function createMemoryStore(ttlMs = DAY_MS, now: () => number = Date.now): GameStore {
  const rooms = new Map<string, { room: Room; expires: number }>();
  const listeners = new Listeners();

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
  };
}
