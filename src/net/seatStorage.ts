/** Where seat tokens live: `sessionStorage` in the browser, per tab. */
type SeatStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SeatMemory {
  get: (code: string) => string | null;
  set: (code: string, token: string) => void;
  forget: (code: string) => void;
}

const currentKey = (code: string) => `seat:v2:${code}`;
const legacyKey = (code: string) => `seat:${code}`;

/**
 * Persists a tab's seat token across reloads under a versioned key (`seat:v2:<code>`).
 * Pre-deployment bundles only read `seat:<code>`, so if a reload during a rolling deploy
 * serves an older client bundle it cannot resume a presence-marked seat through `/ws` onto
 * an old server. Reading still falls back to `seat:<code>` so legacy seats seamlessly upgrade.
 */
export function seatMemory(storage: () => SeatStorage = () => sessionStorage): SeatMemory {
  return {
    get(code) {
      try {
        const box = storage();
        return box.getItem(currentKey(code)) ?? box.getItem(legacyKey(code));
      } catch {
        return null;
      }
    },
    set(code, token) {
      try {
        const box = storage();
        box.setItem(currentKey(code), token);
        box.removeItem(legacyKey(code));
      } catch {
        // Without storage the seat still works until the tab is reloaded.
      }
    },
    forget(code) {
      try {
        const box = storage();
        box.removeItem(currentKey(code));
        box.removeItem(legacyKey(code));
      } catch {
        // Nothing to forget.
      }
    },
  };
}
