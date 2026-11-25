import { describe, expect, it, vi } from "vitest";

import {
  type OnlineEnvironment,
  SEARCH_PULSE_MS,
  trackOnline,
  visitorId,
} from "../src/net/online.ts";
import { isTicket, ONLINE_WINDOW_MS, type OnlineCounts, PULSE_MS } from "../src/net/protocol.ts";
import { handleApi } from "../src/server/http.ts";
import { createMemoryStore } from "../src/server/memoryStore.ts";
import { onlineLine } from "../src/ui/lobby/onlineLine.ts";

const pulse = (store: ReturnType<typeof createMemoryStore>, id: string, searching?: unknown) =>
  handleApi(store, "POST", "/api/online", JSON.stringify({ id, searching }));

describe("POST /api/online", () => {
  it("counts each open tab once, and those searching", async () => {
    const store = createMemoryStore();
    expect(await pulse(store, "tab-a")).toEqual({
      status: 200,
      body: { online: 1, searching: 0 },
    });
    expect((await pulse(store, "tab-b", true)).body).toEqual({ online: 2, searching: 1 });
    expect((await pulse(store, "tab-b", true)).body).toEqual({ online: 2, searching: 1 });
    // Only `true` means searching.
    expect((await pulse(store, "tab-b", "yes")).body).toEqual({ online: 2, searching: 0 });
  });

  it("forgets a tab that leaves, and one that goes quiet for the whole window", async () => {
    let now = 1000;
    const store = createMemoryStore(undefined, () => now);
    await pulse(store, "tab-a", true);
    await pulse(store, "tab-b");
    expect(await handleApi(store, "POST", "/api/online/tab-a/leave", "")).toEqual({
      status: 200,
      body: {},
    });
    expect((await pulse(store, "tab-c")).body).toEqual({ online: 2, searching: 0 });
    now += ONLINE_WINDOW_MS;
    // A background tab, held back to a beat a minute, is still counted.
    expect(ONLINE_WINDOW_MS).toBeGreaterThan(60_000 + PULSE_MS / 2);
    expect((await pulse(store, "tab-c")).body).toEqual({ online: 1, searching: 0 });
  });

  it("refuses ids that are not ticket-shaped, and unknown paths", async () => {
    const store = createMemoryStore();
    expect((await pulse(store, "no spaces")).status).toBe(400);
    expect((await handleApi(store, "POST", "/api/online", "{}")).status).toBe(400);
    expect((await handleApi(store, "POST", "/api/online", "[1]")).status).toBe(400);
    expect((await handleApi(store, "POST", "/api/online/a b/leave", "")).status).toBe(404);
    expect((await handleApi(store, "POST", "/api/online/tab-a/other", "")).status).toBe(404);
    expect((await handleApi(store, "GET", "/api/online", "")).status).toBe(405);
  });
});

type Reply = OnlineCounts | "offline" | "hang";

/** A fake browser: requests take the next reply; timers run only when the test says. */
function fakeBrowser(replies: Reply[]) {
  const requests: Array<{ searching: boolean; answer: (reply: Reply) => void }> = [];
  const timers: Array<{ ms: number; run: () => void; cancelled: boolean }> = [];
  const beacons: string[] = [];
  const page = { hide: () => {}, show: () => {} };
  const env: OnlineEnvironment = {
    fetch: (async (_path: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { id: string; searching: boolean };
      expect(body.id).toBe("tab-1");
      const reply = await new Promise<Reply>((resolve) => {
        requests.push({ searching: body.searching, answer: resolve });
        const scripted = replies.shift();
        if (scripted && scripted !== "hang") resolve(scripted);
      });
      if (reply === "offline") throw new TypeError("Failed to fetch");
      return Response.json(reply);
    }) as typeof fetch,
    later(run, ms) {
      const timer = { ms, run, cancelled: false };
      timers.push(timer);
      return () => (timer.cancelled = true);
    },
    id: () => "tab-1",
    beacon: (url) => beacons.push(url),
    onPage(hide, show) {
      page.hide = hide;
      page.show = show;
    },
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const pending = () => timers.filter((t) => !t.cancelled);
  /** Fires the one timer that is due, as time passing would. */
  const tick = () => {
    const due = pending();
    expect(due).toHaveLength(1);
    due[0]!.cancelled = true;
    due[0]!.run();
  };
  return { env, requests, beacons, page, settle, pending, tick };
}

/** Starts tracking and records every count it hears, in order. */
function track(fake: ReturnType<typeof fakeBrowser>) {
  const seen: Array<OnlineCounts | null> = [];
  const online = trackOnline((counts) => seen.push(counts), fake.env);
  return { online, seen };
}

describe("trackOnline", () => {
  it("says it is here at once and on a beat, faster while searching", async () => {
    const fake = fakeBrowser([
      { online: 3, searching: 0 },
      { online: 3, searching: 1 },
      { online: 4, searching: 1 },
    ]);
    const { online, seen } = track(fake);
    await fake.settle();
    expect(seen).toEqual([{ online: 3, searching: 0 }]);
    expect(fake.pending().map((t) => t.ms)).toEqual([PULSE_MS]);

    // Starting a search is told straight away; the next beat comes sooner.
    online.setSearching(true);
    online.setSearching(true);
    await fake.settle();
    expect(fake.requests.map((r) => r.searching)).toEqual([false, true]);
    expect(fake.pending().map((t) => t.ms)).toEqual([SEARCH_PULSE_MS]);

    fake.tick();
    await fake.settle();
    expect(fake.requests).toHaveLength(3);
    expect(seen).toEqual([
      { online: 3, searching: 0 },
      { online: 3, searching: 1 },
      { online: 4, searching: 1 },
    ]);
  });

  it("uses only the newest answer when an older one comes late", async () => {
    const fake = fakeBrowser(["hang"]);
    const { online, seen } = track(fake);
    online.setSearching(true);
    fake.requests[1]!.answer({ online: 2, searching: 1 });
    await fake.settle();
    fake.requests[0]!.answer({ online: 2, searching: 0 });
    await fake.settle();
    expect(seen).toEqual([{ online: 2, searching: 1 }]);
  });

  it("keeps the beat through a hung request, and takes counts down after two failures", async () => {
    const fake = fakeBrowser([{ online: 2, searching: 0 }, "offline", "hang", "offline"]);
    const { seen } = track(fake);
    await fake.settle();
    fake.tick();
    await fake.settle();
    // One blip keeps the counts.
    expect(seen).toEqual([{ online: 2, searching: 0 }]);
    fake.tick();
    await fake.settle();
    fake.tick();
    await fake.settle();
    expect(fake.requests).toHaveLength(4);
    expect(seen).toEqual([{ online: 2, searching: 0 }, null]);
  });

  it("leaves by beacon as the page goes, and comes back when it is restored", async () => {
    const fake = fakeBrowser([{ online: 1, searching: 0 }, "hang"]);
    const { online, seen } = track(fake);
    await fake.settle();
    fake.page.hide();
    fake.page.hide();
    expect(fake.beacons).toEqual(["/api/online/tab-1/leave"]);
    expect(fake.pending()).toHaveLength(0);
    // Nothing is sent while away, even a change of search.
    online.setSearching(true);
    expect(fake.requests).toHaveLength(1);

    fake.page.show();
    fake.requests[1]!.answer({ online: 5, searching: 2 });
    await fake.settle();
    expect(fake.requests.map((r) => r.searching)).toEqual([false, true]);
    expect(seen.at(-1)).toEqual({ online: 5, searching: 2 });
    expect(fake.pending().map((t) => t.ms)).toEqual([SEARCH_PULSE_MS]);
  });
});

describe("visitorId", () => {
  it("works where crypto.randomUUID is missing, as over plain HTTP on a LAN", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => real.getRandomValues(bytes),
    });
    try {
      const id = visitorId();
      expect(isTicket(id)).toBe(true);
      expect(id).not.toBe(visitorId());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("onlineLine", () => {
  it("counts players, one or many", () => {
    expect(onlineLine({ online: 1, searching: 1 })).toBe("1 player online · 1 searching");
    expect(onlineLine({ online: 12, searching: 0 })).toBe("12 players online · 0 searching");
  });
});
