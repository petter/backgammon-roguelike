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
 * At most two sockets exist at a time: the one in use and, briefly, its replacement. A
 * replacement is opened ahead of the host's time limit and takes over only once it has the
 * current state, so the player never sees that changeover. If the socket in use is lost
 * unexpectedly, the session says so, reconnects with a growing delay, and resyncs from
 * whatever the server sends first.
 */
export function createRemoteSession(
  code: string,
  token: string,
  handlers: SessionHandlers,
  connect: () => ClientSocket = () => new WebSocket(roomUrl(code)) as unknown as ClientSocket,
): Session {
  let active: Link | null = null;
  let incoming: Link | null = null;
  let version = -1;
  let closed = false;
  let attempt = 0;
  let awaitingPong = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let rotateTimer: ReturnType<typeof setTimeout> | undefined;
  let handoverTimer: ReturnType<typeof setTimeout> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;

  const say = (link: Link, message: ClientMessage) => link.socket.send(JSON.stringify(message));

  const stop = () => {
    closed = true;
    for (const timer of [retryTimer, rotateTimer, handoverTimer, pongTimer]) clearTimeout(timer);
    clearInterval(pingTimer);
    for (const link of [active, incoming]) link?.socket.close();
    active = null;
    incoming = null;
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
    previous?.socket.close();
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
      if (message.fatal) stop();
      handlers.onError(message.message, message.fatal);
      return;
    }
    if (!link.ready) {
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

  const retry = () => {
    clearTimeout(retryTimer);
    // The first attempt after a loss is immediate; later ones wait longer each time.
    const delay = attempt === 0 ? 0 : Math.min(250 * 2 ** attempt, RETRY_MAX_MS);
    attempt++;
    retryTimer = setTimeout(() => open(), delay);
  };

  /** Opens a socket: the first one, a reconnection, or a replacement for one in use. */
  function open(): void {
    if (closed || incoming) return;
    const link: Link = { socket: connect(), ready: false };
    incoming = link;
    if (!active) handlers.onStatus(version < 0 ? "connecting" : "reconnecting");
    link.socket.onopen = () => say(link, { type: "hello", token });
    link.socket.onmessage = (event) => {
      if (closed || (link !== active && link !== incoming)) return;
      receive(link, JSON.parse(String(event.data)) as ServerMessage);
    };
    link.socket.onclose = () => {
      if (closed) return;
      if (link === incoming) {
        incoming = null;
        clearTimeout(handoverTimer);
        // A replacement that failed is simply tried again; the socket in use carries on.
        retry();
      } else if (link === active) {
        active = null;
        clearTimeout(rotateTimer);
        clearTimeout(pongTimer);
        handlers.onStatus("reconnecting");
        if (!incoming) retry();
      }
    };
    clearTimeout(handoverTimer);
    handoverTimer = setTimeout(() => {
      if (link === incoming && !link.ready) link.socket.close();
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
      if (awaitingPong && asked === active) asked.socket.close();
    }, PONG_GRACE_MS);
  }, PING_MS);

  open();

  return {
    send(command) {
      if (active) say(active, { type: "command", command });
      else handlers.onError("You are offline. Reconnecting…", false);
    },
    drop() {
      active?.socket.close();
    },
    close: stop,
  };
}
