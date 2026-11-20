import { isRoomCode, parseClientMessage, type ServerMessage } from "../net/protocol.ts";
import { type Connection, openConnection, RoomError } from "./room.ts";
import type { GameStore } from "./store.ts";

/** The few things a WebSocket must do for us. Keeps the room logic free of any transport. */
export interface SocketLike {
  send(text: string): void;
  close(): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
}

/**
 * Runs one client connection. The first message must be `hello` with the seat token; after
 * that, commands. Messages are handled one at a time, in order.
 */
export function serveSocket(store: GameStore, code: string, socket: SocketLike): void {
  let connection: Connection | null = null;
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
    if (closed) return;
    const message = parseClientMessage(text);
    if (!message) return reject("Malformed message");

    if (message.type === "hello") {
      if (connection) return reject("Already connected");
      if (!isRoomCode(code)) return reject("That game no longer exists");
      try {
        const opened = await openConnection(store, code, message.token, send);
        if (closed) opened.close();
        else connection = opened;
      } catch (error) {
        if (!(error instanceof RoomError)) throw error;
        reject(error.message);
      }
      return;
    }

    if (!connection) return reject("Say hello first");
    await connection.command(message.command);
  };

  socket.onMessage((text) => {
    queue = queue
      .then(() => handle(text))
      .catch((error) => {
        console.error("Room connection failed", error);
        reject("Something went wrong on the server");
      });
  });
  socket.onClose(() => {
    closed = true;
    connection?.close();
    connection = null;
  });
}
