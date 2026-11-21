import { characterOf } from "../core/characters.ts";
import type { MatchReply, SeatGrant } from "../net/protocol.ts";
import { cleanName, createMatchedRoom, cryptoEntropy, type Entropy, RoomError } from "./room.ts";
import type { GameStore, Seeker } from "./store.ts";

/**
 * Matchmaking: strangers are paired first come, first served.
 *
 * A seeker holds a ticket and keeps one request open at a time (a long poll). While it is
 * open, the server marks the seeker as seen every tick, so a seeker counts as present
 * exactly while their browser is asking. That holds in a background tab too, where timers
 * are throttled but a request that is already open is not.
 *
 * Pairing is one atomic store step. Only the newer seeker of a pair sets it up, so two
 * seekers waiting for each other never both build a room.
 */
export interface MatchOptions {
  entropy?: Entropy;
  now?: () => number;
  /** How long one wait request is held open before it answers "not yet". */
  holdMs?: number;
  /** How often a held request checks for a match. */
  tickMs?: number;
  /** A seeker not seen for this long has gone: they are never matched and are dropped. */
  freshMs?: number;
  /** Ends a held request early, such as when its client hangs up. */
  signal?: AbortSignal;
}

export const HOLD_MS = 20_000;
export const TICK_MS = 1000;
export const FRESH_MS = 5000;
/** How many of the longest waiting seekers are looked at for a partner. */
const LOOK_AHEAD = 10;
const PAIR_ATTEMPTS = 3;

const gone = () => new RoomError("not_found", "No longer looking for a game");

/** Whether `a` started looking before `b`. Ids break ties, so the order is total. */
function waitedLonger(a: Seeker, b: Seeker): boolean {
  return a.since < b.since || (a.since === b.since && a.id < b.id);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
}

/**
 * Tries to pair a seeker who is still waiting with someone who has waited longer. Returns
 * their seat, or `null` if there is nobody to pair with yet.
 */
async function pairUp(
  store: GameStore,
  me: Seeker,
  entropy: Entropy,
  now: number,
  freshMs: number,
): Promise<SeatGrant | null> {
  const freshAfter = now - freshMs;
  for (let attempt = 0; attempt < PAIR_ATTEMPTS; attempt++) {
    const waiting = await store.waitingSeekers(LOOK_AHEAD);
    for (const stale of waiting.filter((s) => s.seen < freshAfter && s.id !== me.id)) {
      await store.removeSeeker(stale.id);
    }
    // The longest waiting of those who are still there. If that is me, a newer seeker will
    // come to me.
    const partner = waiting.find((s) => s.seen >= freshAfter && waitedLonger(s, me));
    if (!partner) return null;

    // Whoever waited longer is white, as a host would be. Who opens is up to the dice.
    const { code, tokens } = await createMatchedRoom(store, partner, me, entropy);
    const theirs = { code, token: tokens.white };
    const mine = { code, token: tokens.black };
    if (
      await store.pairSeekers(
        { id: partner.id, grant: theirs },
        { id: me.id, grant: mine },
        freshAfter,
      )
    ) {
      return mine;
    }
    // Someone else got to one of us first. The room just made is never entered and expires
    // on its own. If it was me who was taken, that is my match.
    const again = await store.touchSeeker(me.id, now);
    if (!again) throw gone();
    if (again.grant) return again.grant;
  }
  return null;
}

/** Starts looking for a stranger to play. Answers at once, matched or not. */
export async function seekMatch(
  store: GameStore,
  name: unknown,
  character?: unknown,
  options: MatchOptions = {},
): Promise<MatchReply> {
  const { entropy = cryptoEntropy, now = Date.now, freshMs = FRESH_MS } = options;
  const at = now();
  const me: Seeker = {
    id: entropy.token(),
    name: cleanName(name, "Guest"),
    character: characterOf(character),
    since: at,
    seen: at,
  };
  await store.addSeeker(me);
  return { ticket: me.id, seat: await pairUp(store, me, entropy, at, freshMs) };
}

/**
 * Waits for a match, holding the request open for up to `holdMs`. Throws `RoomError`
 * `not_found` if the ticket is unknown: it was cancelled, or its seeker went quiet for too
 * long and was dropped.
 */
export async function awaitMatch(
  store: GameStore,
  ticket: string,
  options: MatchOptions = {},
): Promise<MatchReply> {
  const {
    entropy = cryptoEntropy,
    now = Date.now,
    holdMs = HOLD_MS,
    tickMs = TICK_MS,
    freshMs = FRESH_MS,
    signal,
  } = options;
  const until = now() + holdMs;
  for (;;) {
    const at = now();
    const me = await store.touchSeeker(ticket, at);
    if (!me) throw gone();
    if (me.grant) return { ticket, seat: me.grant };
    const seat = await pairUp(store, me, entropy, at, freshMs);
    if (seat) return { ticket, seat };
    if (signal?.aborted || now() + tickMs > until) return { ticket, seat: null };
    await sleep(tickMs, signal);
    if (signal?.aborted) return { ticket, seat: null };
  }
}

/**
 * Stops looking. If a stranger was found just before, the seat is returned all the same:
 * someone is waiting at that table.
 */
export async function cancelMatch(store: GameStore, ticket: string): Promise<MatchReply> {
  const record = await store.removeSeeker(ticket);
  return { ticket, seat: record?.grant ?? null };
}
