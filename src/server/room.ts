import type { Player } from "../core/board.ts";
import { applyCommand, type Command, GameError, type GameEvent, newGame } from "../core/game.ts";
import { redactEvent, viewFor } from "../core/view.ts";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  type LobbyView,
  NAME_MAX,
  type SeatGrant,
  type ServerMessage,
} from "../net/protocol.ts";
import type { GameStore, Room, RoomUpdate } from "./store.ts";

const SAVE_ATTEMPTS = 5;
const SEED_RANGE = 0x1_0000_0000;

export type RoomErrorKind = "not_found" | "full" | "bad_token" | "busy";

/** A lobby-level failure. The message is safe to show to the player. */
export class RoomError extends Error {
  constructor(
    readonly kind: RoomErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** Source of secrets: seat tokens, room codes and game seeds. Injectable for tests. */
export interface Entropy {
  token(): string;
  /** Integer in [0, n). */
  int(n: number): number;
}

export const cryptoEntropy: Entropy = {
  token: () => crypto.randomUUID(),
  int: (n) => {
    // Rejection sampling, so every value is equally likely.
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    const buffer = new Uint32Array(1);
    do crypto.getRandomValues(buffer);
    while (buffer[0] >= limit);
    return buffer[0] % n;
  },
};

function cleanName(raw: unknown, fallback: string): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
  return name || fallback;
}

function randomCode(entropy: Entropy): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[entropy.int(CODE_ALPHABET.length)],
  ).join("");
}

function seatOf(room: Room, token: string): Player | null {
  if (!token) return null;
  if (room.seats.white?.token === token) return "white";
  if (room.seats.black?.token === token) return "black";
  return null;
}

function lobbyView(room: Room, you: Player): LobbyView {
  const player = (seat: Player) => {
    const taken = room.seats[seat];
    return taken ? { name: taken.name } : null;
  };
  return { code: room.code, you, players: { white: player("white"), black: player("black") } };
}

/** What one seat is told about a room: its own view and events redacted for it. */
export function stateMessage(room: Room, seat: Player, events: GameEvent[]): ServerMessage {
  return {
    type: "state",
    version: room.version,
    lobby: lobbyView(room, seat),
    view: room.game ? viewFor(room.game, seat) : null,
    events: events.map((event) => redactEvent(event, seat)),
  };
}

/** Opens a room with the host in the white seat. */
export async function createRoom(
  store: GameStore,
  name: unknown,
  entropy: Entropy = cryptoEntropy,
): Promise<SeatGrant> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode(entropy);
    const token = entropy.token();
    const seats = { white: { token, name: cleanName(name, "Host") } };
    if (await store.create({ code, version: 0, seats, game: null })) return { code, token };
  }
  throw new RoomError("busy", "Could not find a free room code, try again");
}

/** Takes the second seat and starts the game. */
export async function joinRoom(
  store: GameStore,
  code: string,
  name: unknown,
  entropy: Entropy = cryptoEntropy,
): Promise<SeatGrant> {
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const room = await store.load(code);
    if (!room) throw new RoomError("not_found", "No game with that code");
    if (room.seats.black) throw new RoomError("full", "That game already has two players");

    const token = entropy.token();
    const started = newGame({
      white: entropy.int(SEED_RANGE),
      black: entropy.int(SEED_RANGE),
      play: entropy.int(SEED_RANGE),
    });
    const next: Room = {
      ...room,
      version: room.version + 1,
      seats: { ...room.seats, black: { token, name: cleanName(name, "Guest") } },
      game: started.state,
    };
    if (await store.save(next, room.version)) {
      // The seat is taken whether or not the announcement gets through; the host's
      // connection catches up by itself if it does not.
      await announce(store, code, { room: next, events: started.events });
      return { code, token };
    }
  }
  throw new RoomError("busy", "The game is busy, try again");
}

/**
 * Tells the room's connections about a saved change. The save has already happened, so a
 * failure here must not fail the caller: it is logged, and each connection's periodic
 * resync delivers the change instead. Returns whether the announcement went out.
 */
async function announce(store: GameStore, code: string, update: RoomUpdate): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.publish(code, update);
      return true;
    } catch (error) {
      console.error("Could not announce a room change", error);
    }
  }
  return false;
}

export interface Connection {
  /** Applies a command from this seat. Rule violations come back as error messages. */
  command(command: Command): Promise<void>;
  close(): void;
}

export interface ConnectionOptions {
  entropy?: Entropy;
  /**
   * How often to check the store for a change this connection was never told about.
   * Announcements are best-effort, so this is what bounds how long a player can be stale.
   */
  resyncMs?: number;
}

/**
 * Binds a seat to a way of sending messages. Sends the current state at once, then every
 * later change, each version at most once. Throws `RoomError` if the room or token is not
 * valid.
 */
export async function openConnection(
  store: GameStore,
  code: string,
  token: string,
  send: (message: ServerMessage) => void,
  options: ConnectionOptions = {},
): Promise<Connection> {
  const { entropy = cryptoEntropy, resyncMs = 10_000 } = options;
  const found = await store.load(code);
  if (!found) throw new RoomError("not_found", "That game no longer exists");
  const seat = seatOf(found, token);
  if (!seat) throw new RoomError("bad_token", "You do not have a seat in that game");

  let sent = -1;
  /** Sends a room state unless this connection already has that version or a newer one. */
  const deliver = (room: Room, events: GameEvent[]) => {
    if (room.version <= sent) return;
    sent = room.version;
    send(stateMessage(room, seat, events));
  };

  // Subscribe before taking the snapshot, so no change can fall between the two.
  const unsubscribe = await store.subscribe(code, (update) => deliver(update.room, update.events));
  const snapshot = await store.load(code);
  if (!snapshot) {
    unsubscribe();
    throw new RoomError("not_found", "That game no longer exists");
  }
  deliver(snapshot, []);

  const resync = setInterval(() => {
    store
      .load(code)
      .then((room) => room && deliver(room, []))
      .catch((error) => console.error("Could not resync a room", error));
  }, resyncMs);
  // Never the reason a process stays alive.
  (resync as { unref?: () => void }).unref?.();

  return {
    async command(command) {
      for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
        const room = await store.load(code);
        if (!room) {
          send({ type: "error", message: "That game no longer exists", fatal: true });
          return;
        }
        if (!room.game) {
          send({ type: "error", message: "The game has not started yet", fatal: false });
          return;
        }
        let result: ReturnType<typeof applyCommand>;
        try {
          // Fresh randomness for every command. The stored RNG state is small enough to
          // brute-force from the dice a player sees, so it must never run on as a sequence.
          const game = { ...room.game, rng: entropy.int(SEED_RANGE) };
          result = applyCommand(game, seat, command);
        } catch (error) {
          if (!(error instanceof GameError)) throw error;
          send({ type: "error", message: error.message, fatal: false });
          return;
        }
        const next: Room = { ...room, version: room.version + 1, game: result.state };
        if (await store.save(next, room.version)) {
          await announce(store, code, { room: next, events: result.events });
          // If the announcement reached this connection, this is a no-op. If it did not,
          // the player who acted still sees their own move at once.
          deliver(next, result.events);
          return;
        }
      }
      send({ type: "error", message: "The game is busy, try again", fatal: false });
    },
    close() {
      clearInterval(resync);
      unsubscribe();
    },
  };
}
