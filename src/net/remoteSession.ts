// ClientSocket mirrors the `on*` handler properties of a browser WebSocket, so tests can fake it.
// oxlint-disable unicorn/prefer-add-event-listener

import type { PlayerView } from "../core/view.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";
import type { Session, SessionHandlers } from "./session.ts";

/**
 * How long a socket is used before it is replaced. The host cuts every connection when its
 * function reaches its maximum duration (300 s, set in vercel.json). Replacing the socket
 * well before that means the cut never lands on one that is in use.
 */
export const ROTATE_MS = 240_000;
/** How often the client asks the server whether it is still there. */
export const PING_MS = 20_000;
/** How long an answer may take before the connection is given up as dead. */
export const PONG_GRACE_MS = 8_000;
/** A replacement that has not come up in this time is abandoned and tried again. */
export const HANDOVER_MS = 15_000;
/**
 * The longest a replaced socket is kept while the server still owes it an answer. It is
 * normally closed the moment its last command has been acknowledged.
 */
export const RETIRE_MAX_MS = 30_000;
const RETRY_MAX_MS = 5000;

/** The part of a browser WebSocket this needs. Lets tests supply their own. */
export interface ClientSocket {
  send: (text: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

interface Link {
  socket: ClientSocket;
  /** Whether the server has answered hello with the state: only then can it be used. */
  ready: boolean;
  /** Last game stage delivered on this socket, so stale standalone presence frames are ignored. */
  stage: string;
  /** Highest game version whose presence was delivered by this socket. */
  presenceVersion: number;
  /** Commands sent on this socket that the server has not yet acknowledged. */
  pending: Set<number>;
  /** Whether the server has said, with a `chat` frame, that it has chat. */
  chat: boolean;
}

function gameStage(view: PlayerView | null): string {
  if (!view) return "lobby";
  const games = view.wins.white + view.wins.black;
  return `${games}:${view.phase === "over" ? "over" : "active"}`;
}

function roomUrl(code: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/rooms/${code}/ws2`;
}

/**
 * A seat in a room on the server.
 *
 * One socket is in use at a time. A replacement is opened ahead of the host's time limit and
 * takes over only once it has the current state. Every command carries an id that the server
 * acknowledges, so the socket being replaced is kept exactly until everything sent on it has
 * been answered: the player never sees the changeover and nothing in flight is lost. If the socket in use is lost unexpectedly, the
 * session says so at once, reconnects with a growing delay, and resyncs from whatever the
 * server sends first.
 */
export function createRemoteSession(
  code: string,
  token: string,
  handlers: SessionHandlers,
  connect: () => ClientSocket = () => new WebSocket(roomUrl(code)) as unknown as ClientSocket,
): Required<Session> {
  let active: Link | null = null;
  let incoming: Link | null = null;
  /** Sockets that have been replaced and are being listened to for a little longer. */
  const retiring = new Set<Link>();
  let version = -1;
  let stage = "lobby";
  let closed = false;
  let attempt = 0;
  let everFailed = false;
  let nextId = 0;
  let awaitingPong = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let rotateTimer: ReturnType<typeof setTimeout> | undefined;
  let handoverTimer: ReturnType<typeof setTimeout> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  const retireTimers = new Set<ReturnType<typeof setTimeout>>();

  const say = (link: Link, message: ClientMessage) => link.socket.send(JSON.stringify(message));

  /** Closes a socket and stops listening to it, without waiting for it to confirm. */
  const discard = (link: Link) => {
    link.socket.onopen = null;
    link.socket.onmessage = null;
    link.socket.onclose = null;
    retiring.delete(link);
    link.socket.close();
  };

  const stop = () => {
    closed = true;
    for (const timer of [retryTimer, rotateTimer, handoverTimer, pongTimer, ...retireTimers]) {
      clearTimeout(timer);
    }
    retireTimers.clear();
    clearInterval(pingTimer);
    for (const link of [active, incoming, ...retiring]) if (link) discard(link);
    active = null;
    incoming = null;
  };

  const retry = () => {
    clearTimeout(retryTimer);
    // The first attempt after a loss is immediate; later ones wait longer each time.
    const delay = attempt === 0 ? 0 : Math.min(250 * 2 ** attempt, RETRY_MAX_MS);
    attempt++;
    retryTimer = setTimeout(() => open(), delay);
  };

  /**
   * Lets go of a replaced socket for good. If the server still owed it an answer, that
   * answer will never come now, however this happened, so the player is told once.
   */
  const unanswered = (link: Link) => {
    const owed = retiring.has(link) && link.pending.size > 0;
    discard(link);
    if (owed) {
      handlers.onError("The server did not answer your last action. Check the board.", false);
    }
  };

  /**
   * Deals with a socket that is gone, however that was found out: the browser reported it
   * closed, it stopped answering, or it never came up. Acts at once; a socket can linger
   * half-closed for a long time.
   */
  const lose = (link: Link) => {
    if (closed) return;
    if (link === incoming) {
      incoming = null;
      clearTimeout(handoverTimer);
      discard(link);
      everFailed = true;
      // With a socket in use, a failed replacement is simply tried again later.
      if (!active) handlers.onStatus("reconnecting");
      retry();
    } else if (link === active) {
      active = null;
      awaitingPong = false;
      clearTimeout(rotateTimer);
      clearTimeout(pongTimer);
      discard(link);
      everFailed = true;
      handlers.onStatus("reconnecting");
      if (!incoming) retry();
    } else {
      unanswered(link);
    }
  };

  /**
   * Lets go of a socket that has been replaced: at once if the server owes it nothing,
   * otherwise when its last command is acknowledged, or after a long wait at the latest.
   */
  const retire = (link: Link) => {
    if (link.pending.size === 0) return discard(link);
    retiring.add(link);
    const timer = setTimeout(() => {
      retireTimers.delete(timer);
      unanswered(link);
    }, RETIRE_MAX_MS);
    retireTimers.add(timer);
  };

  /** Makes a socket that has caught up the one in use, and retires the one before it. */
  const promote = (link: Link) => {
    const previous = active;
    active = link;
    incoming = null;
    attempt = 0;
    awaitingPong = false;
    clearTimeout(handoverTimer);
    clearTimeout(pongTimer);
    if (previous) retire(previous);
    handlers.onStatus("connected");
    clearTimeout(rotateTimer);
    rotateTimer = setTimeout(() => open(), ROTATE_MS);
  };

  const receive = (link: Link, message: ServerMessage) => {
    if (message.type === "pong") {
      if (link === active) {
        awaitingPong = false;
        clearTimeout(pongTimer);
      }
      return;
    }
    if (message.type === "done") {
      link.pending.delete(message.id);
      if (retiring.has(link) && link.pending.size === 0) discard(link);
      return;
    }
    if (message.type === "chat") {
      link.chat = true;
      // Lines are facts, whichever socket brings them; the screen merges them by id. Passed
      // on even when empty: the first frame is the log so far, and says so by arriving.
      handlers.onChat?.(message.messages);
      return;
    }
    if (message.type === "presence") {
      if (link === active && link.stage === stage) {
        handlers.onPresence?.({ online: message.online, claimInMs: message.claimInMs });
      }
      return;
    }
    if (message.type === "error") {
      // A socket that is not yet in use carries no action of the player's. Whatever goes
      // wrong on it is its own failure: retried quietly, unless it is the only socket there
      // is and the server says the seat itself is no good.
      if (link === incoming && !(message.fatal && !active)) return lose(link);
      // Only the socket in use, or the only socket there is, can end the session. A
      // replacement that is turned away while another socket works is just a failed
      // replacement; if the seat really is gone, the socket in use will be told too.
      const decisive = link === active || (link === incoming && !active);
      if (message.fatal && !decisive) return lose(link);
      if (message.fatal) stop();
      handlers.onError(message.message, message.fatal);
      return;
    }
    link.stage = gameStage(message.view);
    const justPromoted = link === incoming && !link.ready;
    if (justPromoted) {
      link.ready = true;
      promote(link);
    }
    const newer = message.version > version;
    if (newer) {
      const contiguous = message.version === version + 1;
      version = message.version;
      stage = gameStage(message.view);
      handlers.onUpdate({
        lobby: message.lobby,
        view: message.view,
        events: contiguous ? message.events : [],
      });
    }
    // Sync presence per active socket for the current game stage so a retiring socket
    // delivering an ordinary move first does not discard the replacement's initial away
    // snapshot, while a stale snapshot from an earlier game-over/rematch stage cannot regress
    // the active countdown. Promoting onto an older server without presence support clears
    // stale claim UI silently.
    if (link === active) {
      if (justPromoted && !message.presence && message.view !== null) {
        handlers.onPresence?.(null);
      } else if (
        message.presence &&
        gameStage(message.view) === stage &&
        (justPromoted || message.version > link.presenceVersion)
      ) {
        link.presenceVersion = message.version;
        handlers.onPresence?.(message.presence);
      }
    }
  };

  /** Opens a socket: the first one, a reconnection, or a replacement for one in use. */
  function open(): void {
    if (closed || incoming) return;
    const link: Link = {
      socket: connect(),
      ready: false,
      stage: "lobby",
      presenceVersion: -1,
      pending: new Set(),
      chat: false,
    };
    incoming = link;
    // Only the very first attempt is "connecting"; after any failure the player is told.
    if (!active) handlers.onStatus(everFailed ? "reconnecting" : "connecting");
    link.socket.onopen = () => say(link, { type: "hello", token, presence: true, chat: true });
    link.socket.onmessage = (event) => {
      if (closed) return;
      receive(link, JSON.parse(String(event.data)) as ServerMessage);
    };
    link.socket.onclose = () => lose(link);
    clearTimeout(handoverTimer);
    handoverTimer = setTimeout(() => {
      if (link === incoming && !link.ready) lose(link);
    }, HANDOVER_MS);
  }

  // A connection can die without the browser noticing. Asking regularly, and expecting an
  // answer, finds that out in seconds instead of minutes.
  const pingTimer = setInterval(() => {
    if (!active || awaitingPong) return;
    const asked = active;
    awaitingPong = true;
    say(asked, { type: "ping" });
    clearTimeout(pongTimer);
    pongTimer = setTimeout(() => {
      if (awaitingPong && asked === active) lose(asked);
    }, PONG_GRACE_MS);
  }, PING_MS);

  open();

  return {
    send(command) {
      if (!active) return handlers.onError("You are offline. Reconnecting…", false);
      const id = nextId++;
      active.pending.add(id);
      say(active, { type: "command", command, id });
    },
    say(text) {
      if (!active) return handlers.onError("You are offline. Reconnecting…", false);
      // A server from before chat would take the line as malformed and end the seat.
      if (!active.chat) return handlers.onError("Chat is not available right now", false);
      say(active, { type: "chat", text });
    },
    drop() {
      if (active) lose(active);
    },
    close: stop,
  };
}
