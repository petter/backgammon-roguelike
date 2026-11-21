import type { Server } from "node:http";

import type { Connect, Plugin } from "vite";

import { createMemoryStore } from "./memoryStore.ts";
import { createUpgradeHandler, pathOf, serveApi } from "./node.ts";

/**
 * Runs the game server inside Vite's own dev and preview servers, with rooms kept in memory.
 * `pnpm dev` is then the whole game: no second process, no Redis, same URLs as production.
 */
export function gameServer(): Plugin {
  const store = createMemoryStore();
  const upgrade = createUpgradeHandler(store);

  const attach = (middlewares: Connect.Server, httpServer: Server | null) => {
    middlewares.use((req, res, next) => {
      const path = pathOf(req);
      if (path.startsWith("/g/")) {
        // Invite links are client routes: always serve the app and let it read the code.
        // Left to Vite's own fallback, a malformed path such as `/g/%` would be a bare 404.
        req.url = "/";
        return next();
      }
      if (!path.startsWith("/api/")) return next();
      serveApi(store, req, res);
    });
    // Anything that is not a room socket, such as Vite's own hot-reload socket, is left for
    // other listeners.
    httpServer?.on("upgrade", upgrade);
  };

  return {
    name: "game-server",
    configureServer: (server) => attach(server.middlewares, server.httpServer as Server | null),
    configurePreviewServer: (server) => attach(server.middlewares, server.httpServer as Server),
  };
}
