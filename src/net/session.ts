import type { Command, GameEvent } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";
import type { LobbyView, OpponentPresence } from "./protocol.ts";

export interface SessionUpdate {
  lobby: LobbyView;
  /** `null` while waiting for the second player. */
  view: PlayerView | null;
  /** What happened since the previous update. Empty when steps were missed: just redraw. */
  events: GameEvent[];
}

export type SessionStatus = "connecting" | "connected" | "reconnecting";

export interface SessionHandlers {
  onUpdate: (update: SessionUpdate) => void;
  /**
   * Called when the opponent's connection status changes or on reconnect. `null` means the
   * server does not report presence (e.g. handover to a pre-deployment server) and any
   * stale claim UI should be cleared silently without announcing a reconnect.
   */
  onPresence?: (presence: OpponentPresence | null) => void;
  /** `fatal` means the session is over and will send nothing more. */
  onError: (message: string, fatal: boolean) => void;
  onStatus: (status: SessionStatus) => void;
}

/**
 * The game as seen from one seat: commands go in, views come out. The screen does not know
 * whether the rules run in this tab or on a server.
 */
export interface Session {
  send: (command: Command) => void;
  /** Cuts the connection as a network failure would, to exercise reconnecting. */
  drop: () => void;
  close: () => void;
}
