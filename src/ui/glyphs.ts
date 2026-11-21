import type { CardKind } from "../core/cards.ts";

/**
 * Small printed glyphs on a 12 by 12 grid, in `currentColor`. Details marked `cut` or
 * `cut-line` are cut out of the glyph; the stylesheet colours them for where it sits. A card prints its kind's
 * glyph on the type line, and the same glyph marks what that kind leaves on the table, so
 * a hex on a player's chip and the curse card that cast it look alike.
 */
export const GLYPHS = {
  // A crescent cupping a star: something cast in the dark.
  hex: `<path d="M8.6 1.6a4.8 4.8 0 1 0 1.8 8.2A3.8 3.8 0 1 1 8.6 1.6z"/><path d="M8.4 4.2l.5 1.1 1.1.2-.8.8.2 1.1-1-.5-1 .5.2-1.1-.8-.8 1.1-.2z"/>`,
  // A heater shield with a centre seam.
  ward: `<path d="M6 .6l4.8 1.8V6c0 2.9-2 4.6-4.8 5.4C3.2 10.6 1.2 8.9 1.2 6V2.4z"/><path d="M6 2.4v7.4" class="cut-line" stroke-width="0.9"/>`,
  // A card back lying tilted, its lattice showing: something set face down.
  trap: `<g transform="rotate(-12 6 6)"><rect x="2.4" y="0.4" width="7.2" height="11.2" rx="1.2"/><rect x="3.6" y="1.7" width="4.8" height="8.6" rx="0.5" class="cut-line" fill="none" stroke-width="0.7"/><path d="M6 3.2l1.9 2.8L6 8.8 4.1 6z" class="cut"/></g>`,
  // A four-pointed spark.
  boon: `<path d="M6 .8l1.2 3.9 3.9 1.3-3.9 1.2L6 11.2 4.8 7.2.9 6l3.9-1.3z"/>`,
  // A die face showing three.
  dice: `<rect x="1.4" y="1.4" width="9.2" height="9.2" rx="2"/><g class="cut"><circle cx="3.9" cy="3.9" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="8.1" cy="8.1" r="1"/></g>`,
  // A checker seen from above.
  tactic: `<circle cx="6" cy="6" r="4.8"/><circle cx="6" cy="6" r="2.6" class="cut-line" fill="none" stroke-width="0.9"/>`,
  // An hourglass.
  tempo: `<path d="M2.6 1h6.8v1.2L6.8 6l2.6 3.8V11H2.6V9.8L5.2 6 2.6 2.2z"/>`,
  // A coin on its edge, half lit.
  wild: `<circle cx="6" cy="6" r="4.8"/><path d="M6 1.2a4.8 4.8 0 0 1 0 9.6z" class="cut"/>`,
} as const;

export type GlyphId = keyof typeof GLYPHS;

export const KIND_GLYPH: Record<CardKind, GlyphId> = {
  Curse: "hex",
  Ward: "ward",
  Trap: "trap",
  Dice: "dice",
  Tactic: "tactic",
  Tempo: "tempo",
  Wild: "wild",
};

/** A glyph as an inline SVG element, sized by its container. */
export function glyph(id: GlyphId, className: string): HTMLElement {
  const box = document.createElement("span");
  box.className = className;
  // Fixed markup from our own source.
  box.innerHTML = `<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">${GLYPHS[id]}</svg>`;
  return box;
}
