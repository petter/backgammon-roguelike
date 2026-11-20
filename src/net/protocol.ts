import type { Player } from "../core/board.ts";
import type { Command, GameEvent } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";

export const CODE_LENGTH = 5;
/** No I, L or O: they are too easy to misread when a code is passed along by voice. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const NAME_MAX = 20;

/** What both players may know about the room. Never contains seat tokens. */
export interface LobbyView {
  code: string;
  you: Player;
  players: Record<Player, { name: string } | null>;
}

export type ClientMessage =
  | { type: "hello"; token: string }
  | { type: "command"; command: Command };

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
    }
  /** `fatal` means the seat is unusable and reconnecting will not help. */
  | { type: "error"; message: string; fatal: boolean };

/** Responses of `POST /api/rooms` and `POST /api/rooms/:code/join`. */
export interface SeatGrant {
  code: string;
  token: string;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isRoomCode(value: string): boolean {
  return value.length === CODE_LENGTH && [...value].every((c) => CODE_ALPHABET.includes(c));
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
      ? { type: "hello", token: m.token }
      : null;
  }
  if (m.type === "command") {
    const command = parseCommand(m.command);
    return command ? { type: "command", command } : null;
  }
  return null;
}
