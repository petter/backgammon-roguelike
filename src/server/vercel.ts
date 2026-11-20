import http from "node:http";
import { createMemoryStore } from "./memoryStore.ts";
import { createUpgradeHandler, pathOf, replyJson, serveApi } from "./node.ts";
import { createRedisStore } from "./redisStore.ts";

/**
 * Entry point of the Vercel Function that is the game server: the lobby API over HTTP and
 * room sockets over WebSocket, on one Node server. `vercel.json` sends every `/api/*`
 * request here.
 *
 * Rooms belong in Redis, because two players can land on different instances. Without
 * `REDIS_URL` it falls back to memory, which only works while one instance serves everyone;
 * `/api/health` reports which store is in use.
 */
const redisUrl = process.env.REDIS_URL;
const store = redisUrl ? createRedisStore(redisUrl) : createMemoryStore();
if (!redisUrl) console.warn("REDIS_URL is not set: rooms are kept in this instance's memory");

const server = http.createServer((req, res) => {
  if (pathOf(req) === "/api/health") {
    replyJson(res, 200, {
      ok: true,
      store: redisUrl ? "redis" : "memory",
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    });
    return;
  }
  serveApi(store, req, res);
});

const upgrade = createUpgradeHandler(store);
server.on("upgrade", (req, socket, head) => {
  if (!upgrade(req, socket, head)) socket.destroy();
});

export default server;
