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
 * How long a replaced socket is kept open before it is closed. Anything sent on it just
 * before the changeover is still answered there, so nothing in flight is lost.
 */
export const RETIRE_MS = 6_000;
const RETRY_MAX_MS = 5000;

/** The part of a browser WebSocket this needs. Lets tests supply their own. */
export interface ClientSocket {
  send(text: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

interface Link {
  socket: ClientSocket;
  /** Whether the server has answered hello with the state: only then can it be used. */
  ready: boolean;
}

function roomUrl(code: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/rooms/${code}/ws`;
}

/**
 * A seat in a room on the server.
 *
 * One socket is in use at a time. A replacement is opened ahead of the host's time limit and
 * takes over only once it has the current state; the one it replaces stays open a few
 * seconds longer to hear the answers to anything sent on it, so the player never sees the
 * changeover and nothing in flight is lost. If the socket in use is lost unexpectedly, the
 * session says so at once, reconnects with a growing delay, and resyncs from whatever the
 * server sends first.
 */
export function createRemoteSession(
  code: string,
  token: string,
  handlers: SessionHandlers,
  connect: () => ClientSocket = () => new WebSocket(roomUrl(code)) as unknown as ClientSocket,
): Session {
  let active: Link | null = null;
  let incoming: Link | null = null;
  /** Sockets that have been replaced and are being listened to for a little longer. */
  const retiring = new Set<Link>();
  let version = -1;
  let closed = false;
  let attempt = 0;
  let everFailed = false;
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
      discard(link);
    }
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
    if (previous) {
      retiring.add(previous);
      const timer = setTimeout(() => {
        retireTimers.delete(timer);
        discard(previous);
      }, RETIRE_MS);
      retireTimers.add(timer);
    }
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
    if (message.type === "error") {
      // Only the socket in use, or the only socket there is, can end the session. A
      // replacement that is turned away while another socket works is just a failed
      // replacement; if the seat really is gone, the socket in use will be told too.
      const decisive = link === active || (link === incoming && !active);
      if (message.fatal && !decisive) return lose(link);
      if (message.fatal) stop();
      handlers.onError(message.message, message.fatal);
      return;
    }
    if (link === incoming && !link.ready) {
      link.ready = true;
      promote(link);
    }
    // A snapshot and a live update can cross, and during a changeover two sockets carry the
    // same updates; never go back in time and never apply anything twice.
    if (message.version <= version) return;
    const contiguous = message.version === version + 1;
    version = message.version;
    handlers.onUpdate({
      lobby: message.lobby,
      view: message.view,
      events: contiguous ? message.events : [],
    });
  };

  /** Opens a socket: the first one, a reconnection, or a replacement for one in use. */
  function open(): void {
    if (closed || incoming) return;
    const link: Link = { socket: connect(), ready: false };
    incoming = link;
    // Only the very first attempt is "connecting"; after any failure the player is told.
    if (!active) handlers.onStatus(everFailed ? "reconnecting" : "connecting");
    link.socket.onopen = () => say(link, { type: "hello", token });
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
      if (active) say(active, { type: "command", command });
      else handlers.onError("You are offline. Reconnecting…", false);
    },
    drop() {
      if (active) lose(active);
    },
    close: stop,
  };
}
