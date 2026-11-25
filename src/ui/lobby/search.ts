import { CHARACTERS } from "../../core/characters.ts";
import type { OnlineCounts } from "../../net/protocol.ts";
import { characterArt } from "../characterArt.ts";
import { onlineLine } from "./onlineLine.ts";
import { html, part, type PlayerChoice } from "./parts.ts";

/** "0:07", "1:42", "12:05": how long the player has been looking. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The view while a stranger is being found: the player's own medallion facing an empty
 * seat, how long they have waited, and a way out. It says plainly when the server cannot
 * be reached, while the search carries on underneath.
 */
export function searchRoom(onCancel: () => void): {
  element: HTMLElement;
  show: (player: PlayerChoice) => void;
  trouble: (problem: string | null) => void;
  /** Shows who else is about, or nothing while that is not known. */
  counts: (counts: OnlineCounts | null) => void;
  /** Says the search is being called off, until the next view; Cancel has been pressed. */
  cancelling: () => void;
  /** Stops the clock. */
  stop: () => void;
} {
  const element = document.createElement("section");
  element.className = "searching";
  element.setAttribute("aria-labelledby", "searching-title");
  element.append(
    html(`
      <h2 id="searching-title" class="lobby-heading">Finding an opponent</h2>
      <p class="lede">You'll face the next player to search.</p>
      <div class="face-off" aria-hidden="true">
        <figure class="seat-you"><span class="medallion"></span><figcaption></figcaption></figure>
        <span class="versus">vs</span>
        <figure class="seat-open"><span class="medallion"><span class="ring"></span>?</span><figcaption>Anyone</figcaption></figure>
      </div>
      <p class="waiting-status" role="status"><span class="pulse-dot"></span><span class="search-state">Searching</span><time class="clock">0:00</time></p>
      <p class="online-counts unknown">&nbsp;</p>
      <p class="search-trouble" role="alert" hidden></p>
      <button type="button" class="link cancel">Cancel</button>
    `),
  );
  const medallion = part(element, ".seat-you .medallion");
  const name = part(element, ".seat-you figcaption");
  const clock = part(element, ".clock");
  const troubleLine = part(element, ".search-trouble");
  const state = part(element, ".search-state");
  const countsLine = part(element, ".online-counts");
  const cancel = part(element, ".cancel", HTMLButtonElement);
  cancel.addEventListener("click", onCancel);
  let timer = 0;
  const stop = () => clearInterval(timer);
  return {
    element,
    show(player) {
      medallion.innerHTML = characterArt(player.character);
      name.textContent = player.name || "Guest";
      name.title = CHARACTERS[player.character].name;
      troubleLine.hidden = true;
      state.textContent = "Searching";
      clock.hidden = false;
      cancel.disabled = false;
      const started = Date.now();
      const tick = () => {
        const text = elapsed(Date.now() - started);
        if (clock.textContent !== text) clock.textContent = text;
      };
      tick();
      stop();
      timer = window.setInterval(tick, 1000);
    },
    cancelling() {
      stop();
      state.textContent = "Cancelling…";
      clock.hidden = true;
      troubleLine.hidden = true;
      cancel.disabled = true;
    },
    counts(counts) {
      // Its line is kept while the counts are unknown, so nothing below it jumps when they come.
      countsLine.textContent = counts ? onlineLine(counts) : "\u00a0";
      countsLine.classList.toggle("unknown", !counts);
    },
    trouble(problem) {
      troubleLine.textContent = problem ?? "";
      troubleLine.hidden = !problem;
    },
    stop,
  };
}
