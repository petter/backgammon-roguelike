import { type GameStore, notify, type Room, type RoomUpdate } from "./store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * In-process store. Values are cloned on the way in and out, so callers cannot share
 * references through it, just as they could not through a real database.
 */
export function createMemoryStore(ttlMs = DAY_MS, now: () => number = Date.now): GameStore {
  const rooms = new Map<string, { room: Room; expires: number }>();
  const listeners = new Map<string, Set<(update: RoomUpdate) => void>>();

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
      if (live(room.code)?.version !== expectedVersion) return false;
      put(room);
      return true;
    },
    async publish(code, update) {
      notify(listeners.get(code), update);
    },
    async subscribe(code, listener) {
      const set = listeners.get(code) ?? new Set();
      listeners.set(code, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(code);
      };
    },
  };
}
