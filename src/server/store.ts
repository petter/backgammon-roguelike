import type { Player } from "../core/board.ts";
import type { CharacterId } from "../core/characters.ts";
import type { GameEvent, GameState } from "../core/game.ts";
import type { SeatGrant } from "../net/protocol.ts";

export interface Seat {
  /** Secret that proves a connection owns this seat. */
  token: string;
  name: string;
  /** Who the player appears as. Seats saved before characters existed have none. */
  character?: CharacterId;
}

export interface Room {
  /**
   * Unique to this room for its whole life and never reused. A code can be handed out again
   * after a room expires; the id is what tells the two rooms apart. Never sent to clients.
   */
  id: string;
  code: string;
  /** Bumped on every save. Lets writers detect that someone else got there first. */
  version: number;
  seats: Partial<Record<Player, Seat>>;
  /** `null` until both seats are taken. */
  game: GameState | null;
}

/** Sent to every connection in a room after a successful save. Server-internal: unredacted. */
export interface RoomUpdate {
  room: Room;
  events: GameEvent[];
}

/** How long a seeker is remembered after they were last heard from, or after their match. */
export const SEEKER_TTL_SECONDS = 10 * 60;

/** A player waiting to be matched with a stranger. Server-internal: `id` is their secret. */
export interface Seeker {
  id: string;
  name: string;
  character: CharacterId;
  /** When they started looking, in ms. Whoever has waited longest is matched first. */
  since: number;
  /** When they last showed they are still looking, in ms. */
  seen: number;
  /** Their seat, once they have been matched. A matched seeker is no longer waiting. */
  grant?: SeatGrant;
}

/**
 * Where rooms live and how connections hear about changes. Production uses Redis; local
 * development and tests use memory. Both must pass `tests/storeContract.ts`.
 */
export interface GameStore {
  /** Stores a new room. Resolves `false` if the code is already taken. */
  create: (room: Room) => Promise<boolean>;
  load: (code: string) => Promise<Room | null>;
  /**
   * Compare-and-set: writes only if the stored room has this room's `id` and is still at
   * `expectedVersion`. So a writer that read an expired room cannot overwrite its successor.
   */
  save: (room: Room, expectedVersion: number) => Promise<boolean>;
  publish: (code: string, update: RoomUpdate) => Promise<void>;
  /** Resolves to an unsubscribe function once the listener is live. */
  subscribe: (code: string, listener: (update: RoomUpdate) => void) => Promise<() => void>;

  /** Starts a seeker waiting. */
  addSeeker: (seeker: Seeker) => Promise<void>;
  /** A seeker's record, with `seen` moved to `now` if they are still waiting. */
  touchSeeker: (id: string, now: number) => Promise<Seeker | null>;
  /** Up to `limit` seekers still waiting, longest first, whether or not they were seen lately. */
  waitingSeekers: (limit: number) => Promise<Seeker[]>;
  /**
   * Matches two waiting seekers in one step, handing each their seat. Refuses, changing
   * nothing, unless both are still waiting and both were seen at or after `freshAfter`.
   */
  pairSeekers: (
    a: { id: string; grant: SeatGrant },
    b: { id: string; grant: SeatGrant },
    freshAfter: number,
  ) => Promise<boolean>;
  /**
   * Stops a seeker waiting and forgets them, unless they were already matched: then their
   * record stays, so their seat can still be collected. Returns the record as it was.
   */
  removeSeeker: (id: string) => Promise<Seeker | null>;
}

/**
 * Who is listening to which room. Each `add` is its own registration, even for the same
 * function, and its remove function only ever takes that one registration away.
 */
export class Listeners {
  private readonly byKey = new Map<string, Set<{ listener: (update: RoomUpdate) => void }>>();

  /**
   * Registers a listener. The returned function removes it and reports whether that left
   * the key with no listeners; calling it again does nothing and reports `false`.
   */
  add(key: string, listener: (update: RoomUpdate) => void): () => boolean {
    const entry = { listener };
    let set = this.byKey.get(key);
    if (!set) {
      set = new Set();
      this.byKey.set(key, set);
    }
    set.add(entry);
    return () => {
      const mine = this.byKey.get(key);
      if (!mine?.delete(entry)) return false;
      if (mine.size > 0) return false;
      this.byKey.delete(key);
      return true;
    };
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** Calls every listener with its own copy. One that throws is logged; the rest still run. */
  notify(key: string, update: RoomUpdate): void {
    for (const { listener } of Array.from(this.byKey.get(key) ?? [])) {
      try {
        listener(structuredClone(update));
      } catch (error) {
        console.error("A room listener failed", error);
      }
    }
  }
}
