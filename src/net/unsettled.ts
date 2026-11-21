import { isTicket } from "./protocol.ts";

const KEY = "unsettled-ticket";

/** Where it is kept: `sessionStorage` in the browser, so it survives a reload of the tab. */
type TicketStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface TicketMemory {
  get: () => string | null;
  set: (ticket: string) => void;
  clear: () => void;
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
        const ticket = storage().getItem(KEY);
        return ticket && isTicket(ticket) ? ticket : null;
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
    clear() {
      try {
        storage().removeItem(KEY);
      } catch {
        // Nothing stored.
      }
    },
  };
}
