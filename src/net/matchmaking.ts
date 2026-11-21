import type { CharacterId } from "../core/characters.ts";
import type { MatchReply, SeatGrant } from "./protocol.ts";

export interface SearchHandlers {
  /** A stranger was found: this is the seat to take. Called at most once. */
  onSeat: (seat: SeatGrant) => void;
  /** The server cannot be reached, though the search goes on; `null` once it can again. */
  onTrouble: (problem: string | null) => void;
}

export interface Search {
  /**
   * Stops looking. Resolves to a seat if a stranger was found just before: someone is
   * already sitting at that table, so the caller should take it.
   */
  cancel: () => Promise<SeatGrant | null>;
}

/** The parts of the browser this needs. Tests supply their own. */
export interface SearchEnvironment {
  fetch: typeof fetch;
  delay: (ms: number) => Promise<void>;
  /** Called with a ticket when the page is going away, to stop looking without waiting. */
  beacon: (url: string) => void;
  /** Registers page lifecycle listeners; returns a function that removes them. */
  onPage: (hide: () => void, show: () => void) => () => void;
}

const RETRY_MAX_MS = 10_000;
/** Failures in a row before the player is told; one blip is not worth mentioning. */
const TROUBLE_AFTER = 2;
const TROUBLE = "Can't reach the game server. Still trying…";

async function read(response: Response): Promise<MatchReply> {
  if (!response.ok) throw new Error(`Matchmaking answered ${response.status}`);
  return (await response.json()) as MatchReply;
}

const browser: SearchEnvironment = {
  fetch: (...args) => fetch(...args),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
 * If the server forgets the ticket (it went unasked for too long, say after a laptop
 * slept), the search quietly starts over.
 */
export function findMatch(
  player: { name: string; character: CharacterId },
  handlers: SearchHandlers,
  env: SearchEnvironment = browser,
): Search {
  let ticket: string | null = null;
  let stopped = false;
  /** Bumped whenever the loop is to stop; a loop from an earlier run then ends itself. */
  let run = 0;
  let request = new AbortController();
  /** The request for a ticket, while it is on its way. */
  let seeking: Promise<MatchReply> | null = null;

  const drop = (stale: string) => {
    void env
      .fetch(`/api/match/${stale}/cancel`, { method: "POST", keepalive: true })
      .catch(() => {});
  };
  /**
   * Asks for a ticket. Never aborted: it answers at once, and what it brings must not be
   * lost. A cancel made meanwhile waits for it; if the page went away instead, the ticket
   * it brings is given up.
   */
  const seek = async (mine: number): Promise<MatchReply> => {
    const asking = env
      .fetch("/api/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(player),
      })
      .then(read);
    seeking = asking;
    try {
      const reply = await asking;
      if (mine !== run && !stopped) drop(reply.ticket);
      return reply;
    } finally {
      if (seeking === asking) seeking = null;
    }
  };
  /**
   * Waits on a ticket; `null` if the server no longer knows it. Aborted when the search
   * stops, so the server stops counting the player as present.
   */
  const wait = async (held: string): Promise<MatchReply | null> => {
    const response = await env.fetch(`/api/match/${held}`, {
      method: "POST",
      signal: request.signal,
    });
    return response.status === 404 ? null : read(response);
  };

  const loop = async (mine: number) => {
    let failures = 0;
    // `run` moves on when the search stops or restarts; then this loop is no longer wanted.
    const wanted = () => mine === run;
    while (wanted()) {
      try {
        const reply = ticket ? await wait(ticket) : await seek(mine);
        if (mine !== run) return;
        if (failures >= TROUBLE_AFTER) handlers.onTrouble(null);
        failures = 0;
        ticket = reply?.ticket ?? null;
        if (reply?.seat) {
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
      if (ticket) env.beacon(`/api/match/${ticket}/cancel`);
      ticket = null;
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
      if (stopped) return null;
      const asking = seeking;
      finish();
      let held = ticket;
      if (asking) {
        try {
          const reply = await asking;
          // Matched on arrival: a stranger is already seated at that table.
          if (reply.seat) return reply.seat;
          held = reply.ticket;
        } catch {
          // No ticket was handed out, so there is nothing to give up.
          return null;
        }
      }
      if (!held) return null;
      try {
        const response = await env.fetch(`/api/match/${held}/cancel`, {
          method: "POST",
          keepalive: true,
        });
        if (!response.ok) return null;
        return ((await response.json()) as MatchReply).seat;
      } catch {
        // Unreachable: the server drops the ticket by itself once it stops being asked.
        return null;
      }
    },
  };
}
