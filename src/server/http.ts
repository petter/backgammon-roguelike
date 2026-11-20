import { isRoomCode, normalizeCode } from "../net/protocol.ts";
import { createRoom, joinRoom, RoomError, type RoomErrorKind } from "./room.ts";
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

function nameOf(body: unknown): unknown {
  return typeof body === "object" && body !== null ? (body as { name?: unknown }).name : undefined;
}

/**
 * The lobby's HTTP API, independent of any server framework.
 * `POST /api/rooms` creates a room; `POST /api/rooms/:code/join` takes the second seat.
 */
export async function handleApi(
  store: GameStore,
  method: string,
  path: string,
  body: unknown,
): Promise<ApiResponse> {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "rooms")
    return { status: 404, body: { error: "Not found" } };
  if (method !== "POST") return { status: 405, body: { error: "Method not allowed" } };

  try {
    if (parts.length === 2) return { status: 201, body: await createRoom(store, nameOf(body)) };
    if (parts.length === 4 && parts[3] === "join") {
      const code = normalizeCode(parts[2]);
      if (!isRoomCode(code)) throw new RoomError("not_found", "No game with that code");
      return { status: 200, body: await joinRoom(store, code, nameOf(body)) };
    }
    return { status: 404, body: { error: "Not found" } };
  } catch (error) {
    if (!(error instanceof RoomError)) throw error;
    return { status: STATUS[error.kind], body: { error: error.message } };
  }
}
