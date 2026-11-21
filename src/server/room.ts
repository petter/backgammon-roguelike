import type { Player } from "../core/board.ts";
import { type CharacterId, characterOf } from "../core/characters.ts";
import {
  applyCommand,
  type Command,
  GameError,
  type GameEvent,
  type GameSeeds,
  type GameState,
  newGame,
} from "../core/game.ts";
import { redactEvent, viewFor } from "../core/view.ts";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  type LobbyView,
  NAME_MAX,
  type RoomStatus,
  type SeatGrant,
  type ServerMessage,
} from "../net/protocol.ts";
import type { GameStore, Room, RoomUpdate } from "./store.ts";

const SAVE_ATTEMPTS = 5;
const noop = () => {};
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
  token: () => string;
  /** Integer in [0, n). */
  int: (n: number) => number;
}

export const cryptoEntropy: Entropy = {
  token: () => crypto.randomUUID(),
  int: (n) => {
    // Rejection sampling, so every value is equally likely.
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    const buffer = new Uint32Array(1);
    let value = limit;
    while (value >= limit) value = crypto.getRandomValues(buffer)[0] ?? limit;
    return value % n;
  },
};

export function cleanName(raw: unknown, fallback: string): string {
  const name = typeof raw === "string" ? raw.replaceAll(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
  return name || fallback;
}

/** Three unrelated secrets for a new game, so neither deck gives the other away. */
function freshSeeds(entropy: Entropy): GameSeeds {
  return {
    white: entropy.int(SEED_RANGE),
    black: entropy.int(SEED_RANGE),
    play: entropy.int(SEED_RANGE),
  };
}

function randomCode(entropy: Entropy): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[entropy.int(CODE_ALPHABET.length)],
  ).join("");
}

/** State added after games were first saved; a game saved before it has none. */
type Added =
  | "wins"
  | "rematch"
  | "hexes"
  | "wards"
  | "traps"
  | "extraOffer"
  | "bonusDice"
  | "reversing";

/**
 * Brings a saved game up to date. One saved before matches kept a score has none; if it
 * is already won, the win is the one thing known about the match, so it is counted. One
 * saved before curses, wards and traps has none of them.
 */
function upToDate(game: Omit<GameState, Added> & Partial<Pick<GameState, Added>>): GameState {
  const none = { white: 0, black: 0, ...(game.winner ? { [game.winner]: 1 } : {}) };
  const no = { white: false, black: false };
  return {
    ...game,
    wins: game.wins ?? none,
    rematch: game.rematch ?? no,
    hexes: game.hexes ?? { white: [], black: [] },
    wards: game.wards ?? { white: [], black: [] },
    traps: game.traps ?? { white: [], black: [] },
    extraOffer: game.extraOffer ?? no,
    bonusDice: game.bonusDice ?? { white: 0, black: 0 },
    reversing: game.reversing ?? false,
  };
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
    return taken ? { name: taken.name, character: characterOf(taken.character) } : null;
  };
  return { code: room.code, you, players: { white: player("white"), black: player("black") } };
}

/** What one seat is told about a room: its own view and events redacted for it. */
export function stateMessage(room: Room, seat: Player, events: GameEvent[]): ServerMessage {
  return {
    type: "state",
    version: room.version,
    lobby: lobbyView(room, seat),
    view: room.game ? viewFor(upToDate(room.game), seat) : null,
    events: events.map((event) => redactEvent(event, seat)),
  };
}

/** Opens a room with the host in the white seat. */
export async function createRoom(
  store: GameStore,
  name: unknown,
  entropy: Entropy = cryptoEntropy,
  character?: unknown,
): Promise<SeatGrant> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode(entropy);
    const token = entropy.token();
    const host = { token, name: cleanName(name, "Host"), character: characterOf(character) };
    const seats = { white: host };
    const room: Room = { id: entropy.token(), code, version: 0, seats, game: null };
    if (await store.create(room)) return { code, token };
  }
  throw new RoomError("busy", "Could not find a free room code, try again");
}

/**
 * Opens a room with both seats already taken and the game dealt, for two strangers the
 * matchmaker has paired. Returns each seat's token.
 */
export async function createMatchedRoom(
  store: GameStore,
  white: { name: string; character: CharacterId },
  black: { name: string; character: CharacterId },
  entropy: Entropy = cryptoEntropy,
): Promise<{ code: string; tokens: Record<Player, string> }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode(entropy);
    const tokens = { white: entropy.token(), black: entropy.token() };
    const seats = {
      white: { token: tokens.white, name: white.name, character: white.character },
      black: { token: tokens.black, name: black.name, character: black.character },
    };
    const game = newGame(freshSeeds(entropy)).state;
    const room: Room = { id: entropy.token(), code, version: 0, seats, game };
    if (await store.create(room)) return { code, tokens };
  }
  throw new RoomError("busy", "Could not find a free room code, try again");
}

/**
 * Whether a room still has a seat for a guest, so an invite link can say at once that its
 * game is gone or taken. It reveals nothing a join attempt would not.
 */
export async function roomStatus(store: GameStore, code: string): Promise<RoomStatus> {
  const room = await store.load(code);
  if (!room) throw new RoomError("not_found", "No game with that code");
  return room.seats.black ? "full" : "open";
}

/** Takes the second seat and starts the game. */
export async function joinRoom(
  store: GameStore,
  code: string,
  name: unknown,
  entropy: Entropy = cryptoEntropy,
  character?: unknown,
): Promise<SeatGrant> {
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const room = await store.load(code);
    if (!room) throw new RoomError("not_found", "No game with that code");
    if (room.seats.black) throw new RoomError("full", "That game already has two players");

    const token = entropy.token();
    const started = newGame(freshSeeds(entropy));
    const guest = { token, name: cleanName(name, "Guest"), character: characterOf(character) };
    const next: Room = {
      ...room,
      version: room.version + 1,
      seats: { ...room.seats, black: guest },
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
  command: (command: Command) => Promise<void>;
  close: () => void;
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
 *
 * The connection belongs to one room, identified by its id. If that room disappears or its
 * code comes to mean another room, the connection is told once and shut down.
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
  // A room stored before rooms had ids cannot be told apart from a successor, or saved.
  if (!found?.id) throw new RoomError("not_found", "That game no longer exists");
  const seat = seatOf(found, token);
  if (!seat) throw new RoomError("bad_token", "You do not have a seat in that game");
  const roomId = found.id;

  let sent = -1;
  let closed = false;
  let ready = false;
  // oxlint-disable-next-line prefer-const -- stop() reads it before it is assigned.
  let resync: ReturnType<typeof setInterval> | undefined;
  let unsubscribe = noop;

  /** The whole teardown. Safe to call at any point and more than once. */
  const stop = () => {
    closed = true;
    clearInterval(resync);
    // Taken out before it is called, so the store sees each unsubscribe exactly once, and
    // one that only becomes available later (during setup) is still called.
    const release = unsubscribe;
    unsubscribe = noop;
    release();
  };
  /** Sends an error, unless the connection is closed. */
  const complain = (message: string, fatal: boolean) => {
    if (!closed) send({ type: "error", message, fatal });
  };
  /** Ends the connection because its room is gone or replaced. Tears down even if the send fails. */
  const evict = () => {
    if (closed) return;
    try {
      // During setup the caller has no connection yet and learns through the rejection.
      if (ready) complain("That game no longer exists", true);
    } catch (error) {
      console.error("Could not tell a player their game is gone", error);
    } finally {
      stop();
    }
  };
  /**
   * Sends a room state unless this connection already has that version or a newer one.
   * The version counts as sent only once `send` has returned: if it throws, a later
   * attempt tries again.
   */
  const deliver = (room: Room | null, events: GameEvent[]) => {
    if (closed) return;
    if (!room || room.id !== roomId) return evict();
    if (room.version <= sent) return;
    send(stateMessage(room, seat, events));
    sent = room.version;
  };

  try {
    // Subscribe before taking the snapshot, so no change can fall between the two.
    unsubscribe = await store.subscribe(code, (update) => deliver(update.room, update.events));
    deliver(await store.load(code), []);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- deliver() may have closed it.
    if (closed) throw new RoomError("not_found", "That game no longer exists");
  } catch (error) {
    // No handle is returned on failure, so nobody else could ever remove the listener.
    stop();
    throw error;
  }
  ready = true;

  resync = setInterval(() => {
    store
      .load(code)
      .then((room) => deliver(room, []))
      .catch((error) => console.error("Could not resync a room", error));
  }, resyncMs);
  // Never the reason a process stays alive.
  (resync as { unref?: () => void }).unref?.();

  return {
    async command(command) {
      for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
        const room = await store.load(code);
        // A command the server has received is carried out even if its connection has since
        // closed: the client may simply have moved to a replacement socket. Only the replies
        // to a closed connection are dropped.
        if (!room || room.id !== roomId) return evict();
        if (!room.game) return complain("The game has not started yet", false);
        let result: ReturnType<typeof applyCommand>;
        try {
          // Fresh randomness for every command. The stored RNG state is small enough to
          // brute-force from the dice a player sees, so it must never run on as a sequence.
          const game = { ...upToDate(room.game), rng: entropy.int(SEED_RANGE) };
          const seeds = command.type === "rematch" ? freshSeeds(entropy) : undefined;
          result = applyCommand(game, seat, command, seeds);
        } catch (error) {
          if (!(error instanceof GameError)) throw error;
          return complain(error.message, false);
        }
        const next: Room = { ...room, version: room.version + 1, game: result.state };
        // The store refuses this if the room changed or was replaced since it was loaded.
        if (await store.save(next, room.version)) {
          await announce(store, code, { room: next, events: result.events });
          // If the announcement reached this connection, this is a no-op. If it did not,
          // the player who acted still sees their own move at once.
          try {
            deliver(next, result.events);
          } catch (error) {
            // The move is committed; a failed send is retried by the next resync.
            console.error("Could not send a player their own move", error);
          }
          return;
        }
      }
      complain("The game is busy, try again", false);
    },
    close: stop,
  };
}
