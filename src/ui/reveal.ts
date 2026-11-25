import "./reveal.css";
import type { CardId } from "../core/cards.ts";
import { createCard } from "./card.ts";
import { el } from "./dom.ts";

/**
 * A card shown big over the board with a line on what happened. `trap` turns a face-down
 * trap over as it springs; `hex` flares a hex as it bites; `play` shows a card as it is
 * played; `set` lays a trap face down. A trap set by the opponent has no `card`: only its
 * back is seen.
 */
export interface Reveal {
  card: CardId | null;
  kind: "trap" | "hex" | "play" | "set";
  title: string;
  effect?: string;
}

/** Seconds from a reveal's start until its face is up and can be read. Matches reveal.css. */
export const FACE_UP_AT = 0.55;
/**
 * Seconds from a reveal's start until it starts to go, and until it has gone. Matches
 * reveal.css. A card being played is news for a moment; one that changed the game, longer.
 */
const HOLD = { trap: 3, hex: 3, play: 2.2, set: 2.2 } as const;
const OUT = 0.35;

export interface RevealView {
  /** Shows a card after `delay` seconds. Returns when its face is up, in seconds from now. */
  show: (reveal: Reveal, delay: number) => number;
  clear: () => void;
}

export function createRevealView(): RevealView {
  const root = el("reveal");
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    show(reveal, delay) {
      const item = document.createElement("div");
      item.className = `reveal reveal-${reveal.kind}`;
      if (!reveal.card) item.classList.add("reveal-hidden");
      item.style.setProperty("--delay", `${delay}s`);
      item.style.setProperty("--hold", `${HOLD[reveal.kind]}s`);

      const back = document.createElement("span");
      back.className = "card-back reveal-back";
      const spin = document.createElement("span");
      spin.className = "reveal-spin";
      spin.append(back);
      if (reveal.card) {
        const face = createCard(reveal.card, undefined, true);
        face.classList.add("reveal-face");
        face.tabIndex = -1;
        spin.append(face);
      }
      const flipper = document.createElement("span");
      flipper.className = "reveal-flipper card-large";
      flipper.setAttribute("aria-hidden", "true");
      flipper.append(spin);

      const caption = document.createElement("p");
      caption.className = "reveal-caption";
      const title = document.createElement("strong");
      title.textContent = reveal.title;
      caption.append(title);
      if (reveal.effect) {
        const effect = document.createElement("span");
        effect.textContent = reveal.effect;
        caption.append(effect);
      }

      item.append(flipper, caption);
      root.append(item);
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          item.remove();
        },
        (delay + HOLD[reveal.kind] + OUT) * 1000,
      );
      timers.add(timer);
      return delay + (reveal.kind === "play" ? 0 : FACE_UP_AT);
    },
    clear() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      root.replaceChildren();
    },
  };
}
