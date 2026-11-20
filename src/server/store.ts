import type { Player } from "../core/board.ts";
import type { GameEvent, GameState } from "../core/game.ts";

export interface Seat {
  /** Secret that proves a connection owns this seat. */
  token: string;
  name: string;
}

export interface Room {
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

/**
 * Where rooms live and how connections hear about changes. Production uses Redis; local
 * development and tests use memory. Both must pass `tests/storeContract.ts`.
 */
export interface GameStore {
  /** Stores a new room. Resolves `false` if the code is already taken. */
  create(room: Room): Promise<boolean>;
  load(code: string): Promise<Room | null>;
  /** Compare-and-set: writes only if the stored version is still `expectedVersion`. */
  save(room: Room, expectedVersion: number): Promise<boolean>;
  publish(code: string, update: RoomUpdate): Promise<void>;
  /** Resolves to an unsubscribe function once the listener is live. */
  subscribe(code: string, listener: (update: RoomUpdate) => void): Promise<() => void>;
}
