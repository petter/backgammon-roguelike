import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createMemoryStore } from "../src/server/memoryStore.ts";
import { createUpgradeHandler, serveApi } from "../src/server/node.ts";

const servers: http.Server[] = [];
const clients: WebSocket[] = [];
afterEach(async () => {
  // Upgraded sockets are not HTTP connections any more, so they are ended from this side.
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }),
  );
});

/** The real HTTP and WebSocket stack, as production wires it, on a free local port. */
async function listen() {
  const store = createMemoryStore();
  const server = http.createServer((req, res) => serveApi(store, req, res));
  const upgrade = createUpgradeHandler(store);
  server.on("upgrade", (req, socket, head) => {
    if (!upgrade(req, socket, head)) socket.destroy();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const post = async (path: string, body: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", body });
    return { status: response.status, body: (await response.json()) as Record<string, string> };
  };
  const socket = (code: string) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/api/rooms/${code}/ws`);
    clients.push(client);
    return client;
  };
  return { post, socket };
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) =>
    ws.once("message", (data) =>
      resolve(JSON.parse((data as Buffer).toString()) as Record<string, unknown>),
    ),
  );
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once("close", (code) => resolve(code)));
}

describe("node server", () => {
  it("serves the lobby API and a room socket", async () => {
    const { post, socket } = await listen();
    const created = await post("/api/rooms", '{"name":"Ada"}');
    expect(created.status).toBe(201);
    expect((await post("/api/rooms", "{")).status).toBe(400);
    const ws = socket(created.body.code);
    await opened(ws);
    ws.send(JSON.stringify({ type: "hello", token: created.body.token }));
    expect(await nextMessage(ws)).toMatchObject({ type: "state", version: 0, view: null });
    ws.close();
  });

  it("survives an oversized frame, closing only that socket", async () => {
    const { post, socket } = await listen();
    const { code, token } = (await post("/api/rooms", "")).body;
    const rude = socket(code);
    await opened(rude);
    rude.send(JSON.stringify({ type: "hello", token }));
    await nextMessage(rude);
    const gone = closed(rude);
    rude.send("x".repeat(10_000));
    // 1009: message too big.
    expect(await gone).toBe(1009);

    // The process is still serving: a new socket and the HTTP API both work.
    const polite = socket(code);
    await opened(polite);
    polite.send(JSON.stringify({ type: "hello", token }));
    expect(await nextMessage(polite)).toMatchObject({ type: "state" });
    // Listen first: the announcement arrives while the join request is still in flight.
    const announced = nextMessage(polite);
    expect((await post(`/api/rooms/${code}/join`, "")).status).toBe(200);
    expect(await announced).toMatchObject({ type: "state", version: 1 });
    polite.close();
  });

  it("refuses upgrades that are not room sockets", async () => {
    const { socket } = await listen();
    const stray = socket("../../etc");
    await expect(opened(stray)).rejects.toThrow();
  });
});
