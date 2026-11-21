import { describe, expect, it, vi } from "vitest";

import { CANCEL_TIMEOUT_MS, findMatch, type SearchEnvironment } from "../src/net/matchmaking.ts";
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
  let tickets = 0;
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
    ticket: () => `t${++tickets}`,
    beacon: (url) => beacons.push(url),
    onPage(hide, show) {
      page.hide = hide;
      page.show = show;
      return () => (page.removed = true);
    },
  };
  return { env, calls, beacons, page, settle };
}

/** The ticket a request to start looking carried. */
function ticketOf(body?: string): string {
  return (JSON.parse(body ?? "{}") as { ticket?: string }).ticket ?? "";
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
  it("seeks with the player and its own ticket, waits, and takes the seat once found", async () => {
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
    expect(JSON.parse(server.calls[0]?.body ?? "")).toEqual({ ...player, ticket: "t1" });
    expect(server.page.removed).toBe(true);
  });

  it("starts over with a new ticket when the server has forgotten the old one", async () => {
    const server = fakeServer([{ ticket: "t1", seat: null }, 404, { ticket: "t2", seat }]);
    const { seats, handlers } = recorder();
    findMatch(player, handlers, server.env);
    await settled(server);
    expect(server.calls.map((c) => c.path)).toEqual(["/api/match", "/api/match/t1", "/api/match"]);
    expect(ticketOf(server.calls[2]?.body ?? "")).toBe("t2");
    expect(seats).toEqual([seat]);
  });

  it("asks to start looking again with the same ticket when the first answer is lost", async () => {
    const server = fakeServer(["offline", { ticket: "t1", seat }]);
    const { seats, handlers } = recorder();
    findMatch(player, handlers, server.env);
    await settled(server);
    expect(server.calls.map((c) => ticketOf(c.body ?? ""))).toEqual(["t1", "t1"]);
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

  it("cancels at once while the first answer is still on its way, naming the ticket", async () => {
    // The request to start looking never answers.
    const server = fakeServer(["hang"]);
    const search = findMatch(player, recorder().handlers, server.env);
    expect(await search.cancel()).toBeNull();
    expect(server.calls.map((c) => c.path)).toEqual(["/api/match", "/api/match/t1/cancel"]);
    expect(server.calls[0]?.aborted()).toBe(true);
  });

  it("hands back a seat the server dealt before the cancel, answered or not", async () => {
    const server = fakeServer(["hang"], { ticket: "t1", seat });
    const { seats, handlers } = recorder();
    const search = findMatch(player, handlers, server.env);
    expect(await search.cancel()).toEqual(seat);
    await settled(server);
    expect(seats).toEqual([]);
  });

  it("settles a cancel the server never answers", async () => {
    vi.useFakeTimers();
    try {
      const server = fakeServer([{ ticket: "t1", seat: null }, "hang"]);
      const fetchAll = server.env.fetch;
      server.env.fetch = ((path: string, init?: RequestInit) =>
        path.endsWith("/cancel")
          ? new Promise((_resolve, reject) =>
              init?.signal?.addEventListener("abort", () => reject(new Error("timed out"))),
            )
          : fetchAll(path, init)) as typeof fetch;
      const search = findMatch(player, recorder().handlers, server.env);
      await vi.advanceTimersByTimeAsync(10);
      const cancelled = search.cancel();
      await vi.advanceTimersByTimeAsync(CANCEL_TIMEOUT_MS);
      expect(await cancelled).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops looking when the page goes away, and starts again with a new ticket", async () => {
    const server = fakeServer([{ ticket: "t1", seat: null }, "hang"]);
    const { seats, handlers } = recorder();
    findMatch(player, handlers, server.env);
    await settled(server);
    server.page.hide();
    expect(server.beacons).toEqual(["/api/match/t1/cancel"]);
    expect(server.calls[1]?.aborted()).toBe(true);
    server.page.show();
    await settled(server);
    expect(server.calls.at(-1)?.path).toBe("/api/match");
    expect(ticketOf(server.calls.at(-1)?.body ?? "")).toBe("t2");
    expect(seats).toEqual([]);
  });
});
