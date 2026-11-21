import { opponent, type Player } from "../core/board.ts";
import { CLAIM_GRACE_MS, type OpponentPresence } from "../net/protocol.ts";
import {
  type ClaimTimings,
  completedGames,
  type GameStore,
  opponentAwaySince,
  type Room,
  type RoomPresence,
} from "./store.ts";

export { CLAIM_GRACE_MS };
/**
 * How long a newly seated player has to open their first WebSocket before being treated
 * as disconnected, so a normal join or match never flashes an abandonment banner.
 */
export const ARRIVAL_GRACE_MS = 10_000;
/**
 * How long one server connection's presence lease stays valid without renewal. Must be
 * comfortably longer than `resyncMs` (10 s) so healthy connections never lapse.
 */
export const PRESENCE_LEASE_MS = 25_000;

export interface ComputedPresence {
  presence: OpponentPresence;
  key: string;
}

export interface AcceptedPresence {
  presence: RoomPresence;
  at: number;
  accepted: boolean;
}

export interface PresenceTracker {
  /** Monotonically accepts a newer presence snapshot ordered by `(revision, at)`. */
  accept: (presence: RoomPresence, at?: number) => AcceptedPresence;
  /** Derives the opponent's wire-level presence for a given room and accepted snapshot. */
  compute: (room: Room, accepted: AcceptedPresence) => ComputedPresence | null;
  /** Whether a standalone `presence` frame should be sent for this computed value. */
  shouldSend: (computed: ComputedPresence) => boolean;
  /** Records that a computed presence value was successfully delivered to the client. */
  markSent: (computed: ComputedPresence) => void;
}

/** Identifies the game boundary (completed-game count + active/over) for presence keys. */
function roomStage(room: Room): string {
  if (!room.game) return "lobby";
  return `${completedGames(room.game)}:${room.game.phase === "over" ? "over" : "active"}`;
}

export function opponentPresenceOf(
  room: Room,
  presence: RoomPresence,
  viewer: Player,
  at: number,
  timings: ClaimTimings,
): ComputedPresence | null {
  if (!room.game) return null;
  // Include the game stage in the deduplication key so crossing a game-over/rematch boundary
  // always re-delivers current presence (e.g., if a rotating socket skipped the boundary frame).
  const stage = roomStage(room);
  const awaySince = opponentAwaySince(room, presence, opponent(viewer), at, timings);
  if (awaySince === null) {
    return { presence: { online: true, claimInMs: null }, key: `${stage}:online` };
  }
  if (room.game.phase === "over") {
    return { presence: { online: false, claimInMs: null }, key: `${stage}:away:over` };
  }
  const claimInMs = Math.max(0, timings.claimGraceMs - (at - awaySince));
  return { presence: { online: false, claimInMs }, key: `${stage}:away:${awaySince}` };
}

/** Per-connection monotonic presence filter and deduplicator. */
export function createPresenceTracker(seat: Player, timings: ClaimTimings): PresenceTracker {
  let knownPresence: RoomPresence | null = null;
  let knownPresenceAt = 0;
  let lastRevision = -1;
  let lastKey: string | null = null;

  return {
    accept(presence, at) {
      if (knownPresence) {
        if (presence.revision < lastRevision) {
          return { presence: knownPresence, at: knownPresenceAt, accepted: false };
        }
        if (presence.revision === lastRevision && at !== undefined && at < knownPresenceAt) {
          return { presence: knownPresence, at: knownPresenceAt, accepted: false };
        }
      }
      lastRevision = presence.revision;
      knownPresence = presence;
      if (at !== undefined) knownPresenceAt = at;
      return { presence, at: knownPresenceAt, accepted: true };
    },
    compute(room, accepted) {
      return opponentPresenceOf(room, accepted.presence, seat, accepted.at, timings);
    },
    shouldSend(computed) {
      return computed.key !== lastKey;
    },
    markSent(computed) {
      lastKey = computed.key;
    },
  };
}

/** Announces a live presence change on the dedicated presence channel, best-effort. */
export async function publishPresence(
  store: GameStore,
  roomId: string,
  presence: RoomPresence,
  at: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.publishPresence(roomId, { roomId, presence, at });
      return true;
    } catch (error) {
      console.error("Could not announce a presence change", error);
    }
  }
  return false;
}
