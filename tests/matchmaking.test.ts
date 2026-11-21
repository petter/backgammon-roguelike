import { describe, expect, it } from "vitest";

import { findMatch, type SearchEnvironment } from "../src/net/matchmaking.ts";
import type { MatchReply, SeatGrant } from "../src/net/protocol.ts";

const player = { name: "Ada", character: "seer" as const };
const seat: SeatGrant = { code: "ABCDE", token: "secret" };

type Answer = MatchReply | number | "offline" | "hang";

/**
 * A fake server: each request takes the next answer from the script. A number is an error
 * status, "offline" a network failure, "hang" a request that stays open until aborted.
 */
function fakeServer(script: Answer[], cancelReply: MatchReply = { ticket: "t1", seat: null }) {
  const calls: Array<{ path: string; body?: string; aborted: () => boolean }> = [];
  const beacons: string[] = [];
  const page = { hide: () => {}, show: () => {}, removed: false };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const env: SearchEnvironment = {
    fetch: (async (path: string, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      calls.push({ path, body: init?.body as string, aborted: () => signal?.aborted ?? false });
      if (path.endsWith("/cancel")) return Response.json(cancelReply);
      const answer = script.shift() ?? "hang";
      if (answer === "offline") throw new TypeError("Failed to fetch");
      if (answer === "hang") {
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError"))),
        );
      }
      if (typeof answer === "number") return new Response("{}", { status: answer });
      return Response.json(answer);
    }) as typeof fetch,
    delay: async () => {
      await settle();
    },
    beacon: (url) => beacons.push(url),
    onPage(hide, show) {
      page.hide = hide;
      page.show = show;
      return () => (page.removed = true);
    },
  };
  return { env, calls, beacons, page, settle };
}

function recorder() {
  const seats: SeatGrant[] = [];
  const trouble: Array<string | null> = [];
  return {
    seats,
    trouble,
    handlers: {
      onSeat: (s: SeatGrant) => seats.push(s),
      onTrouble: (t: string | null) => trouble.push(t),
    },
  };
}

async function settled(server: { settle: () => Promise<unknown> }, rounds = 10) {
  for (let i = 0; i < rounds; i++) await server.settle();
}

describe("findMatch", () => {
  it("seeks with the player, waits on the ticket, and takes the seat once found", async () => {
    const server = fakeServer([
      { ticket: "t1", seat: null },
      { ticket: "t1", seat: null },
      { ticket: "t1", seat },
    ]);
    const { seats, handlers } = recorder();
    findMatch(player, handlers, server.env);
    await settled(server);
    expect(seats).toEqual([seat]);
    expect(server.calls.map((c) => c.path)).toEqual([
      "/api/match",
      "/api/match/t1",
      "/api/match/t1",
    ]);
    expect(JSON.parse(server.calls[0]?.body ?? "")).toEqual(player);
    expect(server.page.removed).toBe(true);
  });

  it("starts over when the server has forgotten the ticket", async () => {
    const server = fakeServer([{ ticket: "t1", seat: null }, 404, { ticket: "t2", seat }]);
    const { seats, handlers } = recorder();
    findMatch(player, handlers, server.env);
    await settled(server);
    expect(server.calls.map((c) => c.path)).toEqual(["/api/match", "/api/match/t1", "/api/match"]);
    expect(seats).toEqual([seat]);
  });

  it("says so after repeated failures, keeps trying, and clears it on recovery", async () => {
    const server = fakeServer([
      "offline",
      { ticket: "t1", seat: null },
      500,
      "offline",
      "offline",
      { ticket: "t1", seat },
    ]);
    const { seats, trouble, handlers } = recorder();
    findMatch(player, handlers, server.env);
    await settled(server, 20);
    // One failure on its own is not mentioned.
    expect(trouble).toEqual([expect.any(String), null]);
    expect(seats).toEqual([seat]);
  });

  it("aborts the open wait on cancel and asks the server to forget the ticket", async () => {
    const server = fakeServer([{ ticket: "t1", seat: null }, "hang"]);
    const { seats, handlers } = recorder();
    const search = findMatch(player, handlers, server.env);
    await settled(server);
    expect(await search.cancel()).toBeNull();
    expect(server.calls[1]?.aborted()).toBe(true);
    expect(server.calls.at(-1)?.path).toBe("/api/match/t1/cancel");
    await settled(server);
    expect(seats).toEqual([]);
    expect(await search.cancel()).toBeNull();
  });

  it("hands back a seat that was found just before the cancel", async () => {
    const server = fakeServer([{ ticket: "t1", seat: null }, "hang"], { ticket: "t1", seat });
    const search = findMatch(player, recorder().handlers, server.env);
    await settled(server);
    expect(await search.cancel()).toEqual(seat);
  });

  it("drops a ticket that arrives after the search was cancelled", async () => {
    let answer: (reply: Response) => void = () => {};
    const server = fakeServer([]);
    const fetchAll = server.env.fetch;
    server.env.fetch = ((path: string, init?: RequestInit) =>
      path === "/api/match"
        ? new Promise<Response>((resolve) => (answer = resolve))
        : fetchAll(path, init)) as typeof fetch;
    const search = findMatch(player, recorder().handlers, server.env);
    expect(await search.cancel()).toBeNull();
    answer(Response.json({ ticket: "late", seat: null }));
    await settled(server);
    expect(server.calls.map((c) => c.path)).toEqual(["/api/match/late/cancel"]);
  });

  it("stops looking when the page goes away, and starts again if it comes back", async () => {
    const server = fakeServer([{ ticket: "t1", seat: null }, "hang"]);
    const { seats, handlers } = recorder();
    findMatch(player, handlers, server.env);
    await settled(server);
    server.page.hide();
    expect(server.beacons).toEqual(["/api/match/t1/cancel"]);
    expect(server.calls[1]?.aborted()).toBe(true);
    server.page.show();
    await settled(server);
    // A fresh ticket: the old one was given up on the way out.
    expect(server.calls.at(-1)?.path).toBe("/api/match");
    expect(seats).toEqual([]);
  });
});
