import type { Player } from "../core/board.ts";
import type { CharacterId } from "../core/characters.ts";
import type { GameEvent, GameState } from "../core/game.ts";
import type { ChatMessage, OnlineCounts, SeatGrant } from "../net/protocol.ts";

export interface Seat {
  /** Secret that proves a connection owns this seat. */
  token: string;
  name: string;
  /** Who the player appears as. Seats saved before characters existed have none. */
  character?: CharacterId;
  /**
   * `true` when this seat was created by a presence-aware client that connects exclusively to
   * `/api/rooms/:code/ws2` (rejected by pre-deployment servers). Seats created by older
   * clients or servers omit it and remain ineligible for abandonment claims so a live
   * pre-deployment socket (even after rotating onto another old server) can never be claimed against.
   */
  presence?: true;
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
  /**
   * Epoch ms when the current game (or rematch) began, paired with `gameStartedMatch` (its
   * zero-based match index). Used to give newly seated players a brief arrival window and to
   * prevent a rematch from inheriting disconnect time or a stale start time from an old server.
   */
  gameStartedAt?: number;
  /** Zero-based match index for which `gameStartedAt` was recorded. */
  gameStartedMatch?: number;
}

/** Active connection leases for one seat and when it last became disconnected. */
export interface SeatPresence {
  /** Live connection ids mapped to their lease expiry time (store clock ms). */
  connections: Record<string, number>;
  /** Store clock ms when this seat lost its last connection, or `null` while online / never seen. */
  disconnectedAt: number | null;
}

/** Per-seat connection presence for one room, keyed in the store by `room.id`. */
export interface RoomPresence {
  /** Monotonic revision incremented on every presence write so stale broadcasts are ignored. */
  revision: number;
  white: SeatPresence;
  black: SeatPresence;
}

export interface PresenceSnapshot {
  presence: RoomPresence;
  /** Store clock reading (ms) at which this presence was evaluated. */
  now: number;
}

export interface PresenceChange extends PresenceSnapshot {
  /** Whether the updated seat crossed between online and offline. */
  changed: boolean;
}

export interface RenewResult extends PresenceSnapshot {
  /** `true` if `connId` was still registered and renewed; `false` if its lease had lapsed. */
  active: boolean;
}

export interface ClaimTimings {
  claimGraceMs: number;
  arrivalGraceMs: number;
}

export type ClaimOutcome =
  | { ok: true; presence: RoomPresence; now: number }
  | { ok: false; reason: "conflict"; now: number }
  | { ok: false; reason: "online"; presence: RoomPresence; now: number }
  | { ok: false; reason: "too_early"; remainingMs: number; presence: RoomPresence; now: number };

/** Blank presence for a room whose seats have not connected yet. */
export function emptyPresence(): RoomPresence {
  return {
    revision: 0,
    white: { connections: {}, disconnectedAt: null },
    black: { connections: {}, disconnectedAt: null },
  };
}

/** Completed games in a room, matching `upToDate()` for rooms saved before `wins` existed. */
export function completedGames(game: GameState): number {
  const wins = (game as Partial<Pick<GameState, "wins">>).wins;
  if (wins) return wins.white + wins.black;
  return game.winner ? 1 : 0;
}

/** Zero-based match index of `game`, constant from deal through its game-over screen. */
export function matchIndex(game: GameState): number {
  const total = completedGames(game);
  return game.phase === "over" ? Math.max(0, total - 1) : total;
}

/**
 * Store clock ms when `other` became effectively absent for the current game, or `null` if
 * they are online, still within the initial arrival window, or ineligible because either the
 * game or their seat predates presence-aware `/ws2` routing. Clamped to `gameStartedAt` so a
 * rematch never inherits disconnect time from the previous game's result screen.
 */
export function opponentAwaySince(
  room: Room,
  presence: RoomPresence,
  other: Player,
  at: number,
  timings: Pick<ClaimTimings, "arrivalGraceMs">,
): number | null {
  if (!room.game) return null;
  const startedAt = room.gameStartedAt;
  // Rooms without a matching `(gameStartedAt, gameStartedMatch)` (including rematches written
  // by a pre-deployment server) or seats without the explicit `/ws2` presence opt-in stay
  // ineligible for abandonment claims.
  if (
    startedAt === undefined ||
    room.gameStartedMatch !== matchIndex(room.game) ||
    room.seats[other]?.presence !== true
  ) {
    return null;
  }
  const seat = presence[other];
  let latestExpired: number | null = null;
  for (const exp of Object.values(seat.connections)) {
    if (exp > at) return null;
    if (latestExpired === null || exp > latestExpired) latestExpired = exp;
  }
  const raw = seat.disconnectedAt ?? latestExpired;
  if (raw !== null) return Math.max(raw, startedAt);
  const readyAt = startedAt + timings.arrivalGraceMs;
  return at >= readyAt ? readyAt : null;
}

/** Sent to every connection in a room after a successful save. Server-internal. */
export interface RoomUpdate {
  room: Room;
  events: GameEvent[];
  /** Current seat presence, when carried with a game boundary save (rematch / game over). */
  presence?: RoomPresence;
  /** Store clock reading (ms) when `presence` was produced. */
  at?: number;
}

/**
 * Sent on the dedicated presence channel (`presence:<roomId>`) whenever a seat connects or
 * loses its last connection. Kept off the `room:<code>` game channel so pre-deployment
 * servers never see it or mistake it for a game-state version delivery.
 */
export interface PresenceUpdate {
  roomId: string;
  presence: RoomPresence;
  at: number;
}

/** Sent on a room's chat channel (`chat:<roomId>`) for each new line. */
export interface ChatUpdate {
  roomId: string;
  message: ChatMessage;
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
  /**
   * They stopped looking. The record stays as a marker, so a request to start looking with
   * this ticket that arrives after the cancel cannot bring them back.
   */
  cancelled?: true;
  /** `true` when the client opted into presence-aware WebSocket routing (`/ws2`). */
  presence?: true;
}

/** What is kept of a seeker who cancelled. */
export function cancelledSeeker(id: string): Seeker {
  return { id, name: "", character: "gambler", since: 0, seen: 0, cancelled: true };
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
  /** Announces a live presence change on a dedicated channel separate from game moves. */
  publishPresence: (roomId: string, update: PresenceUpdate) => Promise<void>;
  /** Subscribes to live presence changes for one room id. */
  subscribePresence: (
    roomId: string,
    listener: (update: PresenceUpdate) => void,
  ) => Promise<() => void>;

  /** Authoritative store clock (epoch ms). Redis uses `TIME`; memory uses its injected clock. */
  clock: () => Promise<number>;
  /** Registers an active connection lease for a seat, clearing any disconnect timestamp. */
  connectSeat: (
    roomId: string,
    seat: Player,
    connId: string,
    leaseMs: number,
  ) => Promise<PresenceChange>;
  /**
   * Extends an existing connection's lease without resurrecting a connection that has
   * already closed, and prunes any expired leases on either seat.
   */
  renewSeat: (
    roomId: string,
    seat: Player,
    connId: string,
    leaseMs: number,
  ) => Promise<RenewResult | null>;
  /**
   * Removes a connection's lease. When that leaves the seat with no live connections,
   * records `disconnectedAt` and reports `changed: true`.
   */
  disconnectSeat: (roomId: string, seat: Player, connId: string) => Promise<PresenceChange | null>;
  /** Current presence for a room, with any expired leases pruned as of the store clock. */
  getPresence: (roomId: string) => Promise<PresenceSnapshot>;
  /**
   * Atomically checks the room version and that `opponent` has been absent past
   * `timings.claimGraceMs` on the store clock, then saves the winning room state.
   */
  claimSeat: (
    room: Room,
    expectedVersion: number,
    opponent: Player,
    timings: ClaimTimings,
  ) => Promise<ClaimOutcome>;

  /**
   * Appends a chat line to a room's log, numbered one past the room's last line, and keeps
   * only the newest `keep`. Returns the line as kept. The log expires with the room.
   */
  appendChat: (roomId: string, line: Omit<ChatMessage, "id">, keep: number) => Promise<ChatMessage>;
  /** A room's kept chat lines, oldest first; empty if it has none. */
  loadChat: (roomId: string) => Promise<ChatMessage[]>;
  /** Announces a new chat line on the room's chat channel, separate from game moves. */
  publishChat: (roomId: string, update: ChatUpdate) => Promise<void>;
  subscribeChat: (roomId: string, listener: (update: ChatUpdate) => void) => Promise<() => void>;

  /** Starts a seeker waiting. Resolves `false`, changing nothing, if the id is already known. */
  addSeeker: (seeker: Seeker) => Promise<boolean>;
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
   * Forgets a seeker who has gone quiet: only if they are still waiting and were last seen
   * before `seenBefore`, checked in the same step. Returns whether they were forgotten.
   */
  pruneSeeker: (id: string, seenBefore: number) => Promise<boolean>;
  /**
   * Stops a seeker waiting and leaves a cancelled marker in their place, even for an id not
   * seen yet, unless they were already matched: then their record stays, so their seat can
   * still be collected. Returns the record as it was.
   */
  removeSeeker: (id: string) => Promise<Seeker | null>;

  /**
   * Marks a visitor (one open tab) as here now, searching or not, and forgets every visitor
   * last heard from `windowMs` or more ago, on the store clock. Returns the counts as they
   * then stand, this visitor included.
   */
  pulse: (id: string, searching: boolean, windowMs: number) => Promise<OnlineCounts>;
  /** Forgets a visitor at once, as their tab closes. */
  leave: (id: string) => Promise<void>;
}

/**
 * Who is listening to which room. Each `add` is its own registration, even for the same
 * function, and its remove function only ever takes that one registration away.
 */
export class Listeners<T = RoomUpdate> {
  private readonly byKey = new Map<string, Set<{ listener: (update: T) => void }>>();

  /**
   * Registers a listener. The returned function removes it and reports whether that left
   * the key with no listeners; calling it again does nothing and reports `false`.
   */
  add(key: string, listener: (update: T) => void): () => boolean {
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
  notify(key: string, update: T): void {
    for (const { listener } of Array.from(this.byKey.get(key) ?? [])) {
      try {
        listener(structuredClone(update));
      } catch (error) {
        console.error("A room listener failed", error);
      }
    }
  }
}
