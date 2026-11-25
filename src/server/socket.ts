import { isRoomCode, parseClientMessage, type ServerMessage } from "../net/protocol.ts";
import { type ChatLink, openChat } from "./chat.ts";
import { type Connection, openConnection, RoomError } from "./room.ts";
import type { GameStore } from "./store.ts";

/** The few things a WebSocket must do for us. Keeps the room logic free of any transport. */
export interface SocketLike {
  send: (text: string) => void;
  close: () => void;
  onMessage: (listener: (text: string) => void) => void;
  onClose: (listener: () => void) => void;
}

/**
 * Runs one client connection. The first message must be `hello` with the seat token; after
 * that, commands. Messages are handled one at a time, in order.
 */
export function serveSocket(store: GameStore, code: string, socket: SocketLike): void {
  let connection: Connection | null = null;
  /** Opened beside the game, never in its way: commands do not wait for it. */
  let chat: Promise<ChatLink | null> | null = null;
  let closed = false;
  let queue: Promise<void> = Promise.resolve();

  const send = (message: ServerMessage) => {
    if (!closed) socket.send(JSON.stringify(message));
  };
  const reject = (message: string) => {
    send({ type: "error", message, fatal: true });
    socket.close();
  };

  const handle = async (text: string) => {
    const message = parseClientMessage(text);
    if (!message) return reject("Malformed message");

    if (message.type === "ping") return send({ type: "pong" });

    if (message.type === "hello") {
      if (connection) return reject("Already connected");
      if (!isRoomCode(code)) return reject("That game no longer exists");
      try {
        // Kept even if the socket has closed meanwhile: commands already received behind
        // this hello are still carried out, and the close handler lets go of the room once
        // the queue has drained.
        connection = await openConnection(store, code, message.token, send, {
          supportsPresence: message.presence === true,
        });
      } catch (error) {
        if (!(error instanceof RoomError)) throw error;
        reject(error.message);
        return;
      }
      // Only for clients that know chat frames. Without its first frame the client knows
      // there is no chat on this socket, so a failure or a stall here costs chat, not the
      // game: it is not waited for.
      if (message.chat === true) {
        chat = openChat(store, connection.roomId, connection.seat, send).catch((error) => {
          console.error("Could not open a room's chat", error);
          return null;
        });
      }
      return;
    }

    if (!connection) return reject("Say hello first");
    // A client sends chat only once it has had the first chat frame, which goes out just
    // before the chat is ready, so this is not a real wait.
    if (message.type === "chat") return (await chat)?.say(message.text);
    await connection.command(message.command);
    // After the outcome, never before it: a client may stop listening once it has this.
    if (message.id !== undefined) send({ type: "done", id: message.id });
  };

  socket.onMessage((text) => {
    queue = queue
      .then(() => handle(text))
      .catch((error) => {
        // Not the client's doing and not a verdict on its seat: say so without `fatal`, and
        // close, so that the client simply connects again.
        console.error("Room connection failed", error);
        send({ type: "error", message: "Something went wrong on the server", fatal: false });
        socket.close();
      });
  });
  socket.onClose(() => {
    closed = true;
    // Whatever was received before the close is still carried out, in order; the room is
    // let go of only after that.
    queue = queue.finally(() => {
      connection?.close();
      connection = null;
      // It may still be opening; then it is closed as soon as it is open.
      void chat?.then((link) => link?.close());
      chat = null;
    });
  });
}
