import "./coin.css";

/** Seconds from a coin's toss until it lands on its face. Matches coin.css. */
export const COIN_LANDS_AT = 0.95;

// Struck on each face, in `currentColor`, on a 24 by 24 grid: a sun for heads, a moon for tails.
const SUN = `<circle cx="12" cy="12" r="4.6"/><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round">${Array.from(
  { length: 8 },
  (_, i) => `<path d="M12 2.6v3" transform="rotate(${i * 45} 12 12)"/>`,
).join("")}</g>`;
const MOON = `<path d="M15.6 3.4a8.8 8.8 0 1 0 5 13.6A7 7 0 1 1 15.6 3.4z"/><circle cx="16.8" cy="9.2" r="1"/><circle cx="19" cy="13" r="0.7"/>`;

/** Discs stacked between the faces, so a coin seen edge on has some thickness. */
const RIM_LAYERS = 5;

function face(side: "heads" | "tails"): HTMLElement {
  const disc = document.createElement("span");
  disc.className = `coin-face coin-${side}`;
  // Fixed markup from our own source.
  disc.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${side === "heads" ? SUN : MOON}</svg>`;
  return disc;
}

/**
 * A gold coin thrown up spinning end over end, coming down on `heads` or tails. It starts
 * as soon as it is in the page, or after the `--delay` custom property it inherits.
 */
export function createCoin(heads: boolean): HTMLElement {
  const spin = document.createElement("span");
  spin.className = "coin-spin";
  for (let i = 0; i < RIM_LAYERS; i++) {
    const rim = document.createElement("span");
    rim.className = "coin-rim";
    rim.style.setProperty("--z", `${(i - (RIM_LAYERS - 1) / 2) * 0.05}em`);
    spin.append(rim);
  }
  spin.append(face("heads"), face("tails"));

  const arc = document.createElement("span");
  arc.className = "coin-arc";
  arc.append(spin);

  const coin = document.createElement("span");
  coin.className = `coin ${heads ? "coin-lands-heads" : "coin-lands-tails"}`;
  coin.setAttribute("aria-hidden", "true");
  coin.append(arc);
  return coin;
}
