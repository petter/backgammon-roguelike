import type { CharacterId } from "../core/characters.ts";
import type { MatchReply, SeatGrant } from "./protocol.ts";

export interface SearchHandlers {
  /** A stranger was found: this is the seat to take. Called at most once. */
  onSeat: (seat: SeatGrant) => void;
  /** The server cannot be reached, though the search goes on; `null` once it can again. */
  onTrouble: (problem: string | null) => void;
}

/** How a cancel turned out. */
export interface Cancelled {
  ticket: string;
  /**
   * A seat, if a stranger was found just before: someone is already sitting at that table,
   * so the caller should take it.
   */
  seat: SeatGrant | null;
  /**
   * Whether the server answered. If not, a seat may be waiting all the same: settle the
   * ticket again (`settleTicket`) before looking for another game.
   */
  settled: boolean;
}

export interface Search {
  /** Stops looking. Always resolves, within `CANCEL_TIMEOUT_MS` if the server is silent. */
  cancel: () => Promise<Cancelled>;
}

/** The parts of the browser this needs. Tests supply their own. */
export interface SearchEnvironment {
  fetch: typeof fetch;
  delay: (ms: number) => Promise<void>;
  /** A fresh secret ticket. */
  ticket: () => string;
  /** Called with a ticket when the page is going away, to stop looking without waiting. */
  beacon: (url: string) => void;
  /** Registers page lifecycle listeners; returns a function that removes them. */
  onPage: (hide: () => void, show: () => void) => () => void;
}

const RETRY_MAX_MS = 10_000;
/** Failures in a row before the player is told; one blip is not worth mentioning. */
const TROUBLE_AFTER = 2;
const TROUBLE = "Can't reach the game server. Still trying…";
/** Longest wait for any one answer. The server holds a wait for 20 s; this is beyond that. */
const REQUEST_TIMEOUT_MS = 30_000;
export const CANCEL_TIMEOUT_MS = 5000;

async function read(response: Response): Promise<MatchReply> {
  if (!response.ok) throw new Error(`Matchmaking answered ${response.status}`);
  return (await response.json()) as MatchReply;
}

/**
 * Gives up a ticket on the server: it is refused from then on, unless it was already
 * matched, in which case its seat comes back. Always resolves, within `CANCEL_TIMEOUT_MS`.
 */
export async function settleTicket(
  ticket: string,
  env: Pick<SearchEnvironment, "fetch"> = browser,
): Promise<Cancelled> {
  try {
    const response = await env.fetch(`/api/match/${ticket}/cancel`, {
      method: "POST",
      keepalive: true,
      signal: within(null, CANCEL_TIMEOUT_MS),
    });
    return { ticket, seat: (await read(response)).seat, settled: true };
  } catch {
    return { ticket, seat: null, settled: false };
  }
}

/** A signal that aborts with `signal`, or after `ms`, whichever comes first. */
function within(signal: AbortSignal | null, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const stop = () => {
    clearTimeout(timer);
    controller.abort();
  };
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  return controller.signal;
}

const browser: SearchEnvironment = {
  fetch: (...args) => fetch(...args),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ticket: () => crypto.randomUUID(),
  beacon: (url) => navigator.sendBeacon(url),
  onPage(hide, show) {
    const onHide = () => hide();
    // Restored from the back-forward cache: the search was stopped on the way out.
    const onShow = (event: PageTransitionEvent) => event.persisted && show();
    addEventListener("pagehide", onHide);
    addEventListener("pageshow", onShow);
    return () => {
      removeEventListener("pagehide", onHide);
      removeEventListener("pageshow", onShow);
    };
  },
};

/**
 * Looks for a stranger to play. Keeps one request open at a time: the server holds each
 * for a while and counts the player as present while it does, so the search keeps its
 * place in a background tab, where timers are slowed down but open requests are not.
 *
 * The client chooses its ticket before the first request. So a cancel never has to wait
 * for any answer: it names the ticket, and the server refuses that ticket from then on,
 * even if the request to start looking with it is still on its way. Asking to start
 * looking again with the same ticket is harmless, so a lost answer is simply asked again.
 *
 * If the server forgets the ticket (it went unasked for too long, say after a laptop
 * slept), the search quietly starts over with a new one.
 */
export function findMatch(
  player: { name: string; character: CharacterId },
  handlers: SearchHandlers,
  env: SearchEnvironment = browser,
): Search {
  let ticket = env.ticket();
  /** Whether the server has acknowledged this ticket, so it can be waited on. */
  let known = false;
  let stopped = false;
  /** Bumped whenever the loop is to stop; a loop from an earlier run then ends itself. */
  let run = 0;
  let request = new AbortController();

  const post = (path: string, body?: unknown): Promise<Response> =>
    env.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? "" : JSON.stringify(body),
      signal: within(request.signal, REQUEST_TIMEOUT_MS),
    });
  const renew = () => {
    ticket = env.ticket();
    known = false;
  };

  const loop = async (mine: number) => {
    let failures = 0;
    // `run` moves on when the search stops or restarts; then this loop is no longer wanted.
    const wanted = () => mine === run;
    while (wanted()) {
      try {
        const response = known
          ? await post(`/api/match/${ticket}`)
          : await post("/api/match", { ...player, ticket });
        if (mine !== run) return;
        // The ticket is gone: dropped after going quiet, or given up on the way out.
        if (response.status === 404) {
          renew();
          continue;
        }
        const reply = await read(response);
        if (mine !== run) return;
        if (failures >= TROUBLE_AFTER) handlers.onTrouble(null);
        failures = 0;
        known = true;
        if (reply.seat) {
          finish();
          handlers.onSeat(reply.seat);
          return;
        }
      } catch {
        if (mine !== run) return;
        failures++;
        if (failures === TROUBLE_AFTER) handlers.onTrouble(TROUBLE);
        await env.delay(Math.min(500 * 2 ** failures, RETRY_MAX_MS));
      }
    }
  };

  const start = () => {
    request = new AbortController();
    void loop(++run);
  };
  /** Ends the loop and any request it has open. */
  const halt = () => {
    run++;
    request.abort();
  };
  const forget = env.onPage(
    () => {
      if (stopped) return;
      halt();
      env.beacon(`/api/match/${ticket}/cancel`);
      renew();
    },
    () => {
      if (!stopped) start();
    },
  );
  const finish = () => {
    stopped = true;
    halt();
    forget();
  };

  start();
  return {
    async cancel() {
      if (stopped) return { ticket, seat: null, settled: true };
      finish();
      return settleTicket(ticket, env);
    },
  };
}
