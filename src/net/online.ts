import { type OnlineCounts, PULSE_MS } from "./protocol.ts";

/** How often a tab that is searching asks, so the counts it shows stay lively. */
export const SEARCH_PULSE_MS = 10_000;
/** Longest wait for one answer. A late answer is worth less than the next one. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Failures in a row before the counts are taken down; one blip is not worth it. */
const STALE_AFTER = 2;

/** The parts of the browser this needs. Tests supply their own. */
export interface OnlineEnvironment {
  fetch: typeof fetch;
  /** Runs `run` after `ms`; returns a function that calls it off. */
  later: (run: () => void, ms: number) => () => void;
  /** A fresh id for this tab. */
  id: () => string;
  /** Sends a request as the page goes away, without waiting for it. */
  beacon: (url: string) => void;
  /** Registers page lifecycle listeners for the life of the page. */
  onPage: (hide: () => void, show: () => void) => void;
}

export interface Online {
  /** Whether this tab is looking for a stranger. A change is told to the server at once. */
  setSearching: (searching: boolean) => void;
}

/**
 * A random id for this tab. Not `crypto.randomUUID()`: that is missing over plain HTTP, as
 * on another device reaching `pnpm dev --host`, and this runs as the app starts.
 */
export function visitorId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const nothing = () => {};

const browser: OnlineEnvironment = {
  fetch: (...args) => fetch(...args),
  later(run, ms) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  id: visitorId,
  beacon: (url) => navigator.sendBeacon(url),
  onPage(hide, show) {
    // Restored from the back-forward cache: the tab was taken off on the way out.
    const onShow = (event: PageTransitionEvent) => event.persisted && show();
    addEventListener("pagehide", () => hide());
    addEventListener("pageshow", onShow);
  },
};

/**
 * Keeps this tab on the server's count of who is online, whatever it is showing: the menu,
 * a game, or a search. It says it is still here every so often (more often while searching)
 * and each answer carries the counts. As the page goes away, a beacon takes it off at once;
 * a tab that just vanishes drops off once `ONLINE_WINDOW_MS` has passed. Runs for the life
 * of the page.
 *
 * `onCounts` hears each new answer, or `null` once the counts can no longer be trusted
 * because the server has not answered for a while.
 */
export function trackOnline(
  onCounts: (counts: OnlineCounts | null) => void,
  env: OnlineEnvironment = browser,
): Online {
  const id = env.id();
  let searching = false;
  let failures = 0;
  /**
   * Bumped by every request and by leaving, so only the newest request's answer is used,
   * and none that comes back after the page went away.
   */
  let sent = 0;
  let away = false;
  let cancelNext: () => void = nothing;

  const pulse = async () => {
    cancelNext();
    if (away) return;
    const mine = ++sent;
    // Scheduled now, not on the answer: a hung request must not stop the beat.
    cancelNext = env.later(() => void pulse(), searching ? SEARCH_PULSE_MS : PULSE_MS);
    try {
      const response = await env.fetch("/api/online", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, searching }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Online count answered ${response.status}`);
      const counts = (await response.json()) as OnlineCounts;
      if (mine !== sent) return;
      failures = 0;
      onCounts({ online: counts.online, searching: counts.searching });
    } catch {
      if (mine !== sent) return;
      failures++;
      if (failures === STALE_AFTER) onCounts(null);
    }
  };

  const leave = () => {
    cancelNext();
    sent++;
    env.beacon(`/api/online/${id}/leave`);
  };

  env.onPage(
    () => {
      if (away) return;
      away = true;
      leave();
    },
    () => {
      if (!away) return;
      away = false;
      void pulse();
    },
  );

  void pulse();
  return {
    setSearching(next) {
      if (next === searching) return;
      searching = next;
      void pulse();
    },
  };
}
