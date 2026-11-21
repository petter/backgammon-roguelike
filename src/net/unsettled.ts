import { isTicket } from "./protocol.ts";

// Versioned separately from pre-deployment bundles (`unsettled-ticket`) so a reload onto an
// older bundle during a rolling deploy cannot settle a presence-marked matchmaking ticket
// and enter its seat over legacy `/ws`.
const KEY = "unsettled-ticket:v2";
const LEGACY_KEY = "unsettled-ticket";

/** Where it is kept: `sessionStorage` in the browser, so it survives a reload of the tab. */
type TicketStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface TicketMemory {
  get: () => string | null;
  set: (ticket: string) => void;
  /** Clears only entries matching `ticket` (or all entries if omitted). */
  clear: (ticket?: string) => void;
}

/**
 * Remembers a matchmaking ticket whose cancel went unanswered. The server may have matched
 * it all the same, with a stranger waiting at that table, so it must be settled before the
 * next search, even after a reload. Storage that is missing or refuses is treated as empty.
 */
export function ticketMemory(storage: () => TicketStorage = () => sessionStorage): TicketMemory {
  return {
    get() {
      try {
        const box = storage();
        for (const key of [KEY, LEGACY_KEY]) {
          const ticket = box.getItem(key);
          if (ticket && isTicket(ticket)) return ticket;
        }
        return null;
      } catch {
        return null;
      }
    },
    set(ticket) {
      try {
        storage().setItem(KEY, ticket);
      } catch {
        // The caller keeps it in memory too, for as long as the page is open.
      }
    },
    clear(ticket) {
      try {
        const box = storage();
        if (ticket === undefined || box.getItem(KEY) === ticket) box.removeItem(KEY);
        if (ticket === undefined || box.getItem(LEGACY_KEY) === ticket) box.removeItem(LEGACY_KEY);
      } catch {
        // Nothing stored.
      }
    },
  };
}
