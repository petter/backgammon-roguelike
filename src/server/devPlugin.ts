import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { WebSocketServer } from "ws";
import { normalizeCode } from "../net/protocol.ts";
import { handleApi } from "./http.ts";
import { createMemoryStore } from "./memoryStore.ts";
import { serveSocket } from "./socket.ts";

const BODY_LIMIT = 1024;
const SOCKET_PATH = /^\/api\/rooms\/([A-Za-z]+)\/ws$/;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      text += chunk;
      if (text.length > BODY_LIMIT) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(text ? JSON.parse(text) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * Runs the game server inside Vite's own dev and preview servers, with rooms kept in memory.
 * `pnpm dev` is then the whole game: no second process, no Redis, same URLs as production.
 */
export function gameServer(): Plugin {
  const store = createMemoryStore();

  const attach = (middlewares: Connect.Server, httpServer: Server | null) => {
    middlewares.use((req, res, next) => {
      const path = (req.url ?? "").split("?")[0];
      if (!path.startsWith("/api/")) return next();
      readJson(req)
        .then((body) => handleApi(store, req.method ?? "GET", path, body))
        .then((result) => reply(res, result.status, result.body))
        .catch((error) => {
          console.error("API request failed", error);
          if (!res.headersSent) reply(res, 500, { error: "Something went wrong on the server" });
        });
    });

    const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    httpServer?.on("upgrade", (req, socket, head) => {
      // Anything else, such as Vite's own hot-reload socket, is left for other listeners.
      const match = SOCKET_PATH.exec((req.url ?? "").split("?")[0]);
      if (!match) return;
      sockets.handleUpgrade(req, socket, head, (ws) => {
        serveSocket(store, normalizeCode(match[1]), {
          send: (text) => ws.send(text),
          close: () => ws.close(),
          onMessage: (listener) => ws.on("message", (data) => listener(data.toString())),
          onClose: (listener) => ws.on("close", listener),
        });
      });
    });
  };

  return {
    name: "game-server",
    configureServer: (server) => attach(server.middlewares, server.httpServer as Server | null),
    configurePreviewServer: (server) => attach(server.middlewares, server.httpServer as Server),
  };
}
