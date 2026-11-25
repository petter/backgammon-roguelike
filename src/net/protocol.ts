import type { Player } from "../core/board.ts";
import type { CharacterId } from "../core/characters.ts";
import type { Command, GameEvent } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";

export const CODE_LENGTH = 5;
/** No I, L or O: they are too easy to misread when a code is passed along by voice. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const NAME_MAX = 20;
/** How long an opponent must stay disconnected before the other player may claim victory. */
export const CLAIM_GRACE_MS = 30_000;

/** What both players may know about the room. Never contains seat tokens. */
export interface LobbyView {
  code: string;
  you: Player;
  players: Record<Player, { name: string; character: CharacterId } | null>;
}

/** Whether the opponent is currently connected, and when victory may be claimed if not. */
export interface OpponentPresence {
  /** `true` while the opponent has an active connection (or is still arriving at game start). */
  online: boolean;
  /**
   * Milliseconds until you may claim victory, or `null` when the opponent is online or the
   * game is not in progress. `0` means victory can be claimed right now.
   */
  claimInMs: number | null;
}

export type ClientMessage =
  /** `presence: true` tells the server this client understands standalone `presence` frames. */
  | { type: "hello"; token: string; presence?: true }
  /**
   * `id`, when given, is echoed in a `done` once the command has been dealt with, whatever
   * the outcome. It lets a client know that a socket has nothing more to tell it.
   */
  | { type: "command"; command: Command; id?: number }
  /** "Are you there?" Answered with `pong`. Allowed at any time, before hello too. */
  | { type: "ping" };

export type ServerMessage =
  | {
      type: "state";
      /** Room version. Clients drop anything older than what they already have. */
      version: number;
      lobby: LobbyView;
      /** `null` until both seats are taken. */
      view: PlayerView | null;
      /** What led to this version; empty for a plain snapshot. */
      events: GameEvent[];
      /** Opponent connection status at the time of this snapshot, once a game has started. */
      presence?: OpponentPresence;
    }
  /** Live update when the opponent disconnects or reconnects, without changing room version. */
  | ({ type: "presence" } & OpponentPresence)
  | { type: "pong" }
  /** The command sent with this `id` has been dealt with; its outcome was sent before this. */
  | { type: "done"; id: number }
  /** `fatal` means the seat is unusable and reconnecting will not help. */
  | { type: "error"; message: string; fatal: boolean };

/** Response of `GET /api/rooms/:code`: whether an invite to it can still be taken. */
export type RoomStatus = "open" | "full";

/** Responses of `POST /api/rooms` and `POST /api/rooms/:code/join`. */
export interface SeatGrant {
  code: string;
  token: string;
}

/**
 * Responses of the matchmaking API. `ticket` is the seeker's secret for asking again;
 * `seat` is `null` until a stranger has been found.
 */
export interface MatchReply {
  ticket: string;
  seat: SeatGrant | null;
}

/**
 * Response of `POST /api/online`: open tabs heard from lately, and how many of them are
 * looking for a stranger. Each count includes the tab that asked.
 */
export interface OnlineCounts {
  online: number;
  searching: number;
}

/** How often an open tab tells the server it is still here (`POST /api/online`). */
export const PULSE_MS = 30_000;
/**
 * How long a tab counts as online after it was last heard from. Room for a background tab,
 * whose timers the browser may hold back to once a minute, and for a slow request.
 */
export const ONLINE_WINDOW_MS = 90_000;

/** Whether a value could be a matchmaking ticket: the shape the server hands out. */
export function isTicket(value: string): boolean {
  return /^[A-Za-z0-9-]{1,100}$/.test(value);
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** The room code in an invite path such as `/g/abcde`, or `null` if there is none. */
export function codeFromPath(pathname: string): string | null {
  const match = /^\/g\/([A-Za-z]+)\/?$/.exec(pathname);
  const code = normalizeCode(match?.[1] ?? "");
  return isRoomCode(code) ? code : null;
}

export function isRoomCode(value: string): boolean {
  return value.length === CODE_LENGTH && Array.from(value).every((c) => CODE_ALPHABET.includes(c));
}

function isIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 64;
}

/** Rebuilds a command from untrusted input, keeping only known fields. */
function parseCommand(raw: unknown): Command | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case "roll":
    case "endTurn":
    case "claimVictory":
    case "rematch":
      return { type: c.type };
    case "pickCard":
    case "playCard":
      return isIndex(c.index) ? { type: c.type, index: c.index } : null;
    case "move": {
      const from = c.from === "bar" || isIndex(c.from) ? c.from : null;
      const to = c.to === "off" || isIndex(c.to) ? c.to : null;
      if (from === null || to === null || !isIndex(c.die)) return null;
      return { type: "move", from, to, die: c.die };
    }
    default:
      return null;
  }
}

/** Parses a message from a client. Returns `null` for anything malformed. */
export function parseClientMessage(text: string): ClientMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.type === "hello") {
    return typeof m.token === "string" && m.token.length <= 100
      ? { type: "hello", token: m.token, ...(m.presence === true ? { presence: true } : {}) }
      : null;
  }
  if (m.type === "ping") return { type: "ping" };
  if (m.type === "command") {
    const command = parseCommand(m.command);
    if (!command) return null;
    if (m.id === undefined) return { type: "command", command };
    const id = m.id;
    return typeof id === "number" && Number.isSafeInteger(id) && id >= 0
      ? { type: "command", command, id }
      : null;
  }
  return null;
}
