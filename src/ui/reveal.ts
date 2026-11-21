import "./reveal.css";
import type { CardId } from "../core/cards.ts";
import { createCard } from "./card.ts";
import { el } from "./dom.ts";

/** A card that just changed the game, shown big with a line on what it did. */
export interface Reveal {
  card: CardId;
  /** A trap was face down until now, so it turns over; a hex was cast in plain sight. */
  kind: "trap" | "hex";
  title: string;
  effect: string;
}

/** Seconds from a reveal's start until its face is up and can be read. Matches reveal.css. */
export const FACE_UP_AT = 0.55;
/** Seconds from a reveal's start until it has gone again. Matches reveal.css. */
const GONE_AT = 3.35;

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
      item.style.setProperty("--delay", `${delay}s`);

      const back = document.createElement("span");
      back.className = "card-back reveal-back";
      const face = createCard(reveal.card, undefined, true);
      face.classList.add("reveal-face");
      face.tabIndex = -1;
      const spin = document.createElement("span");
      spin.className = "reveal-spin";
      spin.append(back, face);
      const flipper = document.createElement("span");
      flipper.className = "reveal-flipper card-large";
      flipper.setAttribute("aria-hidden", "true");
      flipper.append(spin);

      const caption = document.createElement("p");
      caption.className = "reveal-caption";
      const title = document.createElement("strong");
      title.textContent = reveal.title;
      const effect = document.createElement("span");
      effect.textContent = reveal.effect;
      caption.append(title, effect);

      item.append(flipper, caption);
      root.append(item);
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          item.remove();
        },
        (delay + GONE_AT) * 1000,
      );
      timers.add(timer);
      return delay + FACE_UP_AT;
    },
    clear() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      root.replaceChildren();
    },
  };
}
