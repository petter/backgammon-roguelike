import type { ClientMessage, ServerMessage } from "./protocol.ts";
import type { Session, SessionHandlers } from "./session.ts";

const RETRY_MAX_MS = 5000;

/** A seat in a room on the server. Reconnects by itself and resyncs from the server's view. */
export function createRemoteSession(
  code: string,
  token: string,
  handlers: SessionHandlers,
): Session {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${location.host}/api/rooms/${code}/ws`;
  let socket: WebSocket | null = null;
  let version = -1;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const say = (message: ClientMessage) => socket?.send(JSON.stringify(message));

  const receive = (message: ServerMessage) => {
    if (message.type === "error") {
      if (message.fatal) closed = true;
      handlers.onError(message.message, message.fatal);
      return;
    }
    attempt = 0;
    handlers.onStatus("connected");
    // A snapshot and a live update can cross; never go back in time.
    if (message.version <= version) return;
    const contiguous = message.version === version + 1;
    version = message.version;
    handlers.onUpdate({
      lobby: message.lobby,
      view: message.view,
      events: contiguous ? message.events : [],
    });
  };

  const open = () => {
    handlers.onStatus(version < 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => say({ type: "hello", token });
    ws.onmessage = (event) => {
      if (socket === ws && !closed) receive(JSON.parse(String(event.data)) as ServerMessage);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      if (closed) return;
      handlers.onStatus("reconnecting");
      timer = setTimeout(open, Math.min(500 * 2 ** attempt++, RETRY_MAX_MS));
    };
  };
  open();

  return {
    send(command) {
      if (socket?.readyState === WebSocket.OPEN) say({ type: "command", command });
      else handlers.onError("Not connected, try again in a moment", false);
    },
    drop() {
      socket?.close();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      socket?.close();
      socket = null;
    },
  };
}
