import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { normalizeCode } from "../net/protocol.ts";
import { BODY_LIMIT, handleApi } from "./http.ts";
import { serveSocket } from "./socket.ts";
import type { GameStore } from "./store.ts";

const SOCKET_PATH = /^\/api\/rooms\/([A-Za-z]+)\/ws$/;

/** The path of a request, without its query string. */
export function pathOf(req: IncomingMessage): string {
  return (req.url ?? "").split("?")[0];
}

/**
 * Reads the request body as text. Stops keeping data once it is over the limit, but still
 * resolves, so the caller can answer with a proper error instead of a dropped connection.
 */
function readText(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (text.length <= BODY_LIMIT) text += chunk;
    });
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}

export function replyJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Answers one lobby API request on a Node HTTP server. */
export function serveApi(store: GameStore, req: IncomingMessage, res: ServerResponse): void {
  readText(req)
    .then((body) => handleApi(store, req.method ?? "GET", pathOf(req), body))
    .then((result) => replyJson(res, result.status, result.body))
    .catch((error) => {
      console.error("API request failed", error);
      if (!res.headersSent) replyJson(res, 500, { error: "Something went wrong on the server" });
    });
}

/**
 * Returns an upgrade handler for a Node HTTP server. It takes over requests for a room's
 * socket and returns `false` for anything else, leaving those to other listeners.
 */
export function createUpgradeHandler(
  store: GameStore,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  return (req, socket, head) => {
    const match = SOCKET_PATH.exec(pathOf(req));
    if (!match) return false;
    sockets.handleUpgrade(req, socket, head, (ws) => {
      serveSocket(store, normalizeCode(match[1]), {
        send: (text) => ws.send(text),
        close: () => ws.close(),
        onMessage: (listener) => ws.on("message", (data) => listener(data.toString())),
        onClose: (listener) => ws.on("close", listener),
      });
    });
    return true;
  };
}
