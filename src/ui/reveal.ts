import "./reveal.css";
import type { CardId } from "../core/cards.ts";
import { createCard } from "./card.ts";
import { COIN_LANDS_AT, createCoin } from "./coin.ts";
import { el } from "./dom.ts";
import { prefersLessMotion } from "./gameOver.ts";

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

/** A coin tossed over the board, landing `heads` or tails, with a line on what that does. */
export interface CoinReveal {
  heads: boolean;
  title: string;
  effect: string;
}

/** Seconds from a reveal's start until its face is up and can be read. Matches reveal.css. */
export const FACE_UP_AT = 0.55;
/**
 * Seconds from a reveal's start until it starts to go, and until it has gone. Matches
 * reveal.css. A card being played is news for a moment; one that changed the game, longer.
 */
const HOLD = { trap: 3, hex: 3, play: 2.2, set: 2.2, coin: 2.8 } as const;
const OUT = 0.35;

export interface RevealView {
  /** Shows a card after `delay` seconds. Returns when its face is up, in seconds from now. */
  show: (reveal: Reveal, delay: number) => number;
  /** Tosses a coin after `delay` seconds. Returns when it lands, in seconds from now. */
  toss: (coin: CoinReveal, delay: number) => number;
  clear: () => void;
}

function captionOf(title: string, effect?: string): HTMLElement {
  const caption = document.createElement("p");
  caption.className = "reveal-caption";
  const strong = document.createElement("strong");
  strong.textContent = title;
  caption.append(strong);
  if (effect) {
    const line = document.createElement("span");
    line.textContent = effect;
    caption.append(line);
  }
  return caption;
}

export function createRevealView(): RevealView {
  const root = el("reveal");
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** Puts an item up over the board after `delay` seconds and takes it down when its time is up. */
  const mount = (item: HTMLElement, kind: keyof typeof HOLD, delay: number) => {
    item.className = `reveal reveal-${kind} ${item.className}`.trim();
    item.style.setProperty("--delay", `${delay}s`);
    item.style.setProperty("--hold", `${HOLD[kind]}s`);
    root.append(item);
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        item.remove();
      },
      (delay + HOLD[kind] + OUT) * 1000,
    );
    timers.add(timer);
  };
  return {
    show(reveal, delay) {
      const item = document.createElement("div");
      if (!reveal.card) item.className = "reveal-hidden";

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

      item.append(flipper, captionOf(reveal.title, reveal.effect));
      mount(item, reveal.kind, delay);
      return delay + (reveal.kind === "play" ? 0 : FACE_UP_AT);
    },
    toss(coin, delay) {
      const item = document.createElement("div");
      const tossed = createCoin(coin.heads);
      tossed.classList.add("card-large");
      item.append(tossed, captionOf(coin.title, coin.effect));
      mount(item, "coin", delay);
      // Without the toss it has landed as soon as it shows.
      return delay + (prefersLessMotion() ? 0 : COIN_LANDS_AT);
    },
    clear() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      root.replaceChildren();
    },
  };
}
