/** Where the setting lives: `localStorage` in the browser, so it holds across games and visits. */
type GuideStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "guides:off";

export interface GuidePrefs {
  /** Whether the player has turned the in-game guides off. */
  off: () => boolean;
  setOff: (off: boolean) => void;
}

/**
 * Whether the in-game guides (the goal card at the start, the bear-off card) are shown.
 * Storage that is missing or refuses, as in some private windows, leaves them on.
 */
export function guidePrefs(storage: () => GuideStorage = () => localStorage): GuidePrefs {
  return {
    off() {
      try {
        return storage().getItem(KEY) === "1";
      } catch {
        return false;
      }
    },
    setOff(off) {
      try {
        if (off) storage().setItem(KEY, "1");
        else storage().removeItem(KEY);
      } catch {
        // Not remembered; the guides simply come back next time.
      }
    },
  };
}
