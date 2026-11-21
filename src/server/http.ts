import { isRoomCode, normalizeCode } from "../net/protocol.ts";
import { createRoom, joinRoom, RoomError, type RoomErrorKind, roomStatus } from "./room.ts";
import type { GameStore } from "./store.ts";

export interface ApiResponse {
  status: number;
  body: unknown;
}

const STATUS: Record<RoomErrorKind, number> = {
  not_found: 404,
  full: 409,
  bad_token: 403,
  busy: 503,
};

/** Longest request body the lobby accepts, in UTF-16 code units. */
export const BODY_LIMIT = 1024;

/** The fields a player may send about themselves. Still untrusted: the room cleans them. */
function playerOf(body: unknown): { name?: unknown; character?: unknown } {
  return typeof body === "object" && body !== null ? body : {};
}

/** Whether the room behind an invite still has a seat for the guest. */
async function status(store: GameStore, raw: string): Promise<ApiResponse> {
  const code = normalizeCode(raw);
  try {
    if (!isRoomCode(code)) throw new RoomError("not_found", "No game with that code");
    return { status: 200, body: { status: await roomStatus(store, code) } };
  } catch (error) {
    if (!(error instanceof RoomError)) throw error;
    return { status: STATUS[error.kind], body: { error: error.message } };
  }
}

/** An empty body is fine (no name given); anything else must be valid JSON. */
function parseBody(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === "") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * The lobby's HTTP API, independent of any server framework.
 * `POST /api/rooms` creates a room; `POST /api/rooms/:code/join` takes the second seat;
 * `GET /api/rooms/:code` says whether that seat is still free.
 * Takes the raw body text, so a malformed or oversized request is refused before it can
 * take a seat.
 */
export async function handleApi(
  store: GameStore,
  method: string,
  path: string,
  bodyText: string,
): Promise<ApiResponse> {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "rooms")
    return { status: 404, body: { error: "Not found" } };
  if (method === "GET" && parts.length === 3) return status(store, parts[2] ?? "");
  if (method !== "POST") return { status: 405, body: { error: "Method not allowed" } };
  if (bodyText.length > BODY_LIMIT) return { status: 413, body: { error: "Request too large" } };
  const parsed = parseBody(bodyText);
  if (!parsed.ok) return { status: 400, body: { error: "Request body is not valid JSON" } };
  const body = parsed.value;

  try {
    const { name, character } = playerOf(body);
    if (parts.length === 2) {
      return { status: 201, body: await createRoom(store, name, undefined, character) };
    }
    if (parts.length === 4 && parts[3] === "join") {
      const code = normalizeCode(parts[2] ?? "");
      if (!isRoomCode(code)) throw new RoomError("not_found", "No game with that code");
      return { status: 200, body: await joinRoom(store, code, name, undefined, character) };
    }
    return { status: 404, body: { error: "Not found" } };
  } catch (error) {
    if (!(error instanceof RoomError)) throw error;
    return { status: STATUS[error.kind], body: { error: error.message } };
  }
}
