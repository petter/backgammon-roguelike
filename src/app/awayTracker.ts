import { CLAIM_GRACE_MS, type OpponentPresence } from "../net/protocol.ts";
import type { OpponentAwayState } from "../ui/hud.ts";

/** Small client margin so the button never enables a few milliseconds ahead of the server clock. */
const CLAIM_BUFFER_MS = 150;
const TICK_MS = 250;

export interface AwayTrackerCallbacks {
  onBanner: (away: OpponentAwayState | null) => void;
  onOnlineChange: (online: boolean) => void;
  onReconnected: (opponentName: string) => void;
}

export interface AwayTracker {
  isOnline: () => boolean;
  /** Installs the latest game view status and reconciles the countdown timer. */
  setGame: (active: boolean, opponentName: string | null) => void;
  /**
   * Applies an opponent presence snapshot or live update from the session. Passing `null`
   * clears stale claim UI silently (e.g. after handover to a server without presence support).
   */
  onPresence: (presence: OpponentPresence | null) => void;
  /** Marks a claim command in flight; returns `false` if claiming is not currently allowed. */
  beginClaim: (offline: boolean) => boolean;
  /** Re-enables claiming if the server refused a claim attempt. */
  onClaimError: () => void;
  stop: () => void;
}

/**
 * Tracks opponent disconnect state and drives the local monotonic countdown until victory
 * can be claimed, reconciling the tick timer whenever either presence or game view changes.
 */
export function createAwayTracker(
  callbacks: AwayTrackerCallbacks,
  now: () => number = () => performance.now(),
): AwayTracker {
  let online = true;
  let activeGame = false;
  let opponentName: string | null = null;
  /** Monotonic timestamp for the displayed countdown (exact server remaining duration). */
  let displayAt: number | null = null;
  /** Monotonic timestamp when claiming becomes enabled (includes the small client safety margin). */
  let claimAt: number | null = null;
  let claiming = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopTimer = () => {
    clearInterval(timer);
    timer = undefined;
  };

  const sync = () => {
    if (!activeGame || !opponentName || online || displayAt === null || claimAt === null) {
      stopTimer();
      callbacks.onBanner(null);
      return;
    }
    const t = now();
    const displayMs = Math.max(0, displayAt - t);
    const ready = t >= claimAt;
    const secondsLeft = ready ? 0 : Math.max(1, Math.ceil(displayMs / 1000));
    callbacks.onBanner({
      name: opponentName,
      secondsLeft,
      progress: Math.min(1, displayMs / CLAIM_GRACE_MS),
      claiming,
    });
    if (ready) stopTimer();
    else timer ??= setInterval(sync, TICK_MS);
  };

  return {
    isOnline: () => online,
    setGame(active, name) {
      activeGame = active;
      opponentName = name;
      if (!active) {
        displayAt = null;
        claimAt = null;
        claiming = false;
      }
      sync();
    },
    onPresence(presence) {
      const wasOnline = online;
      if (presence === null) {
        online = true;
        displayAt = null;
        claimAt = null;
        claiming = false;
        sync();
        if (!wasOnline) callbacks.onOnlineChange(true);
        return;
      }
      online = presence.online;
      if (presence.online) {
        displayAt = null;
        claimAt = null;
        claiming = false;
        if (!wasOnline && activeGame && opponentName) callbacks.onReconnected(opponentName);
      } else if (presence.claimInMs === null) {
        displayAt = null;
        claimAt = null;
        claiming = false;
      } else {
        claiming = false;
        displayAt = now() + presence.claimInMs;
        claimAt = presence.claimInMs === 0 ? displayAt : displayAt + CLAIM_BUFFER_MS;
      }
      sync();
      if (wasOnline !== online) callbacks.onOnlineChange(online);
    },
    beginClaim(offline) {
      if (!activeGame || online || claiming || offline || claimAt === null) return false;
      if (claimAt - now() > 0) return false;
      claiming = true;
      sync();
      return true;
    },
    onClaimError() {
      if (!claiming) return;
      claiming = false;
      sync();
    },
    stop() {
      stopTimer();
      callbacks.onBanner(null);
    },
  };
}
