import { opponent, type Player } from "../core/board.ts";
import { type CharacterId, characterOf } from "../core/characters.ts";
import {
  applyCommand,
  type Command,
  GameError,
  type GameEvent,
  type GameSeeds,
  newGame,
} from "../core/game.ts";
import { redactEvent, viewFor } from "../core/view.ts";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  type LobbyView,
  NAME_MAX,
  type OpponentPresence,
  type RoomStatus,
  type SeatGrant,
  type ServerMessage,
} from "../net/protocol.ts";
import {
  ARRIVAL_GRACE_MS,
  CLAIM_GRACE_MS,
  createPresenceTracker,
  PRESENCE_LEASE_MS,
  publishPresence,
} from "./presence.ts";
import { upToDate } from "./savedGame.ts";
import {
  type ClaimTimings,
  type GameStore,
  matchIndex,
  type Room,
  type RoomPresence,
  type RoomUpdate,
  type Seat,
} from "./store.ts";

const SAVE_ATTEMPTS = 5;
const noop = () => {};
const SEED_RANGE = 0x1_0000_0000;

export { ARRIVAL_GRACE_MS, CLAIM_GRACE_MS, PRESENCE_LEASE_MS };

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
export function stateMessage(
  room: Room,
  seat: Player,
  events: GameEvent[],
  presence?: OpponentPresence,
): ServerMessage {
  return {
    type: "state",
    version: room.version,
    lobby: lobbyView(room, seat),
    view: room.game ? viewFor(upToDate(room.game), seat) : null,
    events: events.map((event) => redactEvent(event, seat)),
    ...(presence ? { presence } : {}),
  };
}

function makeSeat(token: string, name: string, character: CharacterId, presence: boolean): Seat {
  return { token, name, character, ...(presence ? { presence: true as const } : {}) };
}

/** Opens a room with the host in the white seat. */
export async function createRoom(
  store: GameStore,
  name: unknown,
  entropy: Entropy = cryptoEntropy,
  character?: unknown,
  presence = true,
): Promise<SeatGrant> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode(entropy);
    const token = entropy.token();
    const host = makeSeat(token, cleanName(name, "Host"), characterOf(character), presence);
    const room: Room = {
      id: entropy.token(),
      code,
      version: 0,
      seats: { white: host },
      game: null,
    };
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
  white: { name: string; character: CharacterId; presence?: boolean },
  black: { name: string; character: CharacterId; presence?: boolean },
  entropy: Entropy = cryptoEntropy,
): Promise<{ code: string; tokens: Record<Player, string> }> {
  const gameStartedAt = await store.clock();
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode(entropy);
    const tokens = { white: entropy.token(), black: entropy.token() };
    const seats = {
      white: makeSeat(tokens.white, white.name, white.character, white.presence !== false),
      black: makeSeat(tokens.black, black.name, black.character, black.presence !== false),
    };
    const game = newGame(freshSeeds(entropy)).state;
    const room: Room = {
      id: entropy.token(),
      code,
      version: 0,
      seats,
      game,
      gameStartedAt,
      gameStartedMatch: matchIndex(game),
    };
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

export interface JoinOptions {
  entropy?: Entropy;
  character?: unknown;
  presence?: boolean;
}

/** Takes the second seat and starts the game. */
export async function joinRoom(
  store: GameStore,
  code: string,
  name: unknown,
  entropyOrOptions: Entropy | JoinOptions = cryptoEntropy,
  character?: unknown,
): Promise<SeatGrant> {
  const isEntropy = "token" in entropyOrOptions;
  const entropy = isEntropy ? entropyOrOptions : (entropyOrOptions.entropy ?? cryptoEntropy);
  const chosenCharacter = isEntropy ? character : entropyOrOptions.character;
  const presence = isEntropy ? true : (entropyOrOptions.presence ?? true);
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const room = await store.load(code);
    if (!room) throw new RoomError("not_found", "No game with that code");
    if (room.seats.black) throw new RoomError("full", "That game already has two players");

    const token = entropy.token();
    const started = newGame(freshSeeds(entropy));
    const guest = makeSeat(token, cleanName(name, "Guest"), characterOf(chosenCharacter), presence);
    const next: Room = {
      ...room,
      version: room.version + 1,
      seats: { ...room.seats, black: guest },
      game: started.state,
      gameStartedAt: await store.clock(),
      gameStartedMatch: matchIndex(started.state),
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
  /** How long an opponent must stay disconnected before victory may be claimed. */
  claimGraceMs?: number;
  /** Grace window after game start before an opponent who never connected counts as away. */
  arrivalGraceMs?: number;
  /** How long each presence lease lasts before needing renewal. */
  leaseMs?: number;
  /**
   * Whether the client understands standalone `presence` frames. Older clients from before a
   * rolling deploy omit `presence: true` in `hello` and must only receive `state` frames.
   */
  supportsPresence?: boolean;
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
  const {
    entropy = cryptoEntropy,
    resyncMs = 10_000,
    claimGraceMs = CLAIM_GRACE_MS,
    arrivalGraceMs = ARRIVAL_GRACE_MS,
    leaseMs = PRESENCE_LEASE_MS,
    supportsPresence = true,
  } = options;
  const found = await store.load(code);
  // A room stored before rooms had ids cannot be told apart from a successor, or saved.
  if (!found?.id) throw new RoomError("not_found", "That game no longer exists");
  const seat = seatOf(found, token);
  if (!seat) throw new RoomError("bad_token", "You do not have a seat in that game");
  const roomId = found.id;
  const connId = entropy.token();

  let sent = -1;
  let closed = false;
  let ready = false;
  let registered = false;
  let latestRoom: Room = found;
  const timings: ClaimTimings = { claimGraceMs, arrivalGraceMs };
  const tracker = createPresenceTracker(seat, timings);
  // oxlint-disable-next-line prefer-const -- stop() reads it before it is assigned.
  let resync: ReturnType<typeof setInterval> | undefined;
  let unsubscribeRoom = noop;
  let unsubscribePresence = noop;

  const announcePresence = (presence: RoomPresence, at: number) => {
    void publishPresence(store, roomId, presence, at);
  };

  /** Always detaches available subscriptions, even when assigned after an earlier stop(). */
  const releaseSubscriptions = () => {
    const releaseRoom = unsubscribeRoom;
    const releasePresence = unsubscribePresence;
    unsubscribeRoom = noop;
    unsubscribePresence = noop;
    releaseRoom();
    releasePresence();
  };

  /** The whole teardown. Safe to call at any point and more than once. */
  const stop = (evicted = false) => {
    releaseSubscriptions();
    if (closed) return;
    closed = true;
    clearInterval(resync);
    if (!evicted && registered) {
      registered = false;
      void (async () => {
        try {
          const left = await store.disconnectSeat(roomId, seat, connId);
          if (left?.changed) announcePresence(left.presence, left.now);
        } catch (error) {
          console.error("Could not update presence on close", error);
        }
      })();
    }
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
      stop(true);
    }
  };
  /** Sends a live presence update whenever the opponent's status or away window changed. */
  const deliverPresence = (room: Room, presence: RoomPresence, at?: number) => {
    if (closed || room.id !== roomId) return;
    const current = tracker.accept(presence, at);
    if (!current.accepted || !supportsPresence) return;
    const computed = tracker.compute(room, current);
    if (!computed || !tracker.shouldSend(computed)) return;
    send({ type: "presence", ...computed.presence });
    tracker.markSent(computed);
  };
  /**
   * Sends a room state unless this connection already has that version or a newer one.
   * Presence is attached only when a fresh `(presence, at)` pair is passed — never a stale
   * cached timestamp, which would rewind an active countdown on ordinary moves.
   * The version counts as sent only once `send` has returned: if it throws, a later
   * attempt tries again.
   */
  const deliver = (
    room: Room | null,
    events: GameEvent[],
    presence?: RoomPresence,
    at?: number,
  ) => {
    if (closed) return;
    if (!room || room.id !== roomId) return evict();
    if (room.version >= latestRoom.version) latestRoom = room;
    const latest = presence ? tracker.accept(presence, at) : null;
    if (room.version <= sent) return;
    const computed = latest && at !== undefined ? tracker.compute(room, latest) : null;
    send(stateMessage(room, seat, events, computed?.presence));
    sent = room.version;
    if (computed) tracker.markSent(computed);
  };

  try {
    // Subscribe before loading the snapshot so no change can fall between the two. While
    // setup is still registering the seat's lease, incoming broadcasts are buffered rather
    // than sent early (sending state before `connectSeat` lets a rotating socket close its
    // predecessor before the new lease exists in Redis).
    unsubscribeRoom = await store.subscribe(code, (update) => {
      if (update.room.id !== roomId) return evict();
      if (!ready) {
        if (update.room.version >= latestRoom.version) latestRoom = update.room;
        if (update.presence) tracker.accept(update.presence, update.at);
        return;
      }
      deliver(update.room, update.events, update.presence, update.at);
      if (update.presence) deliverPresence(latestRoom, update.presence, update.at);
    });
    // Eviction may have fired synchronously or mid-await before `subscribe()` resolved.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- listener may have evicted us.
    if (closed) {
      releaseSubscriptions();
      throw new RoomError("not_found", "That game no longer exists");
    }
    unsubscribePresence = await store.subscribePresence(roomId, (update) => {
      if (update.roomId !== roomId) return;
      if (!ready) {
        tracker.accept(update.presence, update.at);
        return;
      }
      deliverPresence(latestRoom, update.presence, update.at);
    });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- room listener may have evicted us while awaiting.
    if (closed) {
      releaseSubscriptions();
      throw new RoomError("not_found", "That game no longer exists");
    }
    const current = await store.load(code);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- subscription may have evicted us while awaiting.
    if (closed || !current || current.id !== roomId) {
      throw new RoomError("not_found", "That game no longer exists");
    }
    if (current.version >= latestRoom.version) latestRoom = current;
    const joined = await store.connectSeat(roomId, seat, connId, leaseMs);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- a pub/sub eviction may have run while awaiting.
    if (closed) {
      await store.disconnectSeat(roomId, seat, connId).catch(() => {});
      throw new RoomError("not_found", "That game no longer exists");
    }
    registered = true;
    // Reconcile joined presence with any newer presence broadcast received during setup.
    const initial = tracker.accept(joined.presence, joined.now);
    deliver(latestRoom, [], initial.presence, initial.at);
    ready = true;
    if (joined.changed && latestRoom.game) {
      announcePresence(joined.presence, joined.now);
    }
  } catch (error) {
    // No handle is returned on failure, so remove both listeners and any lease registered.
    if (registered) {
      registered = false;
      await store.disconnectSeat(roomId, seat, connId).catch(() => {});
    }
    stop(true);
    throw error;
  }

  resync = setInterval(() => {
    void (async () => {
      try {
        const room = await store.load(code);
        if (closed) return;
        if (!room || room.id !== roomId) return evict();
        const renewed = await store.renewSeat(roomId, seat, connId, leaseMs);
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- close() can run while awaiting.
        if (closed) return;
        if (!renewed?.active) {
          // The lease lapsed during a store or event-loop stall, yet this socket is still
          // open: re-register safely so the opponent cannot claim against a live connection.
          const healed = await store.connectSeat(roomId, seat, connId, leaseMs);
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- close() can run while awaiting.
          if (closed) {
            void store.disconnectSeat(roomId, seat, connId).catch(() => {});
            return;
          }
          deliver(room, [], healed.presence, healed.now);
          deliverPresence(latestRoom, healed.presence, healed.now);
          if (healed.changed && latestRoom.game) {
            announcePresence(healed.presence, healed.now);
          }
          return;
        }
        deliver(room, [], renewed.presence, renewed.now);
        deliverPresence(latestRoom, renewed.presence, renewed.now);
      } catch (error) {
        console.error("Could not resync a room", error);
      }
    })();
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
        if (command.type === "claimVictory") {
          const next: Room = { ...room, version: room.version + 1, game: result.state };
          const claimed = await store.claimSeat(next, room.version, opponent(seat), timings);
          if (!claimed.ok) {
            if (claimed.reason === "conflict") continue;
            if (room.version >= latestRoom.version) latestRoom = room;
            deliverPresence(latestRoom, claimed.presence, claimed.now);
            if (claimed.reason === "online") return complain("Your opponent is connected", false);
            return complain(
              `Wait ${Math.ceil(claimed.remainingMs / 1000)}s before claiming victory`,
              false,
            );
          }
          await announce(store, code, {
            room: next,
            events: result.events,
            presence: claimed.presence,
            at: claimed.now,
          });
          try {
            deliver(next, result.events, claimed.presence, claimed.now);
          } catch (error) {
            console.error("Could not send a player their own move", error);
          }
          return;
        }
        const restarted = result.events.some((event) => event.type === "gameStarted");
        const next: Room = {
          ...room,
          version: room.version + 1,
          game: result.state,
          ...(restarted
            ? {
                gameStartedAt: await store.clock(),
                gameStartedMatch: matchIndex(result.state),
              }
            : {}),
        };
        // The store refuses this if the room changed or was replaced since it was loaded.
        if (await store.save(next, room.version)) {
          let latestPresence: RoomPresence | undefined;
          let latestAt: number | undefined;
          if (restarted || result.state.phase === "over") {
            // Optional enrichment: never fail a committed move if reading presence errors.
            try {
              const snap = await store.getPresence(room.id);
              latestPresence = snap.presence;
              latestAt = snap.now;
            } catch (error) {
              console.error("Could not read presence after save", error);
            }
          }
          await announce(store, code, {
            room: next,
            events: result.events,
            ...(latestPresence ? { presence: latestPresence, at: latestAt } : {}),
          });
          // If the announcement reached this connection, this is a no-op. If it did not,
          // the player who acted still sees their own move at once.
          try {
            deliver(next, result.events, latestPresence, latestAt);
          } catch (error) {
            // The move is committed; a failed send is retried by the next resync.
            console.error("Could not send a player their own move", error);
          }
          return;
        }
      }
      complain("The game is busy, try again", false);
    },
    close: () => stop(false),
  };
}
