import "./marks.css";
import type { Player } from "../core/board.ts";
import { CARDS } from "../core/cards.ts";
import type { PlayerView } from "../core/view.ts";

/**
 * What lies on the table in front of a player beside their checkers: hexes waiting to bite
 * them, wards standing guard, traps set face down, and boons still to come.
 */
export interface Mark {
  kind: "hex" | "ward" | "trap" | "boon";
  label: string;
  /** The longer explanation, for a tooltip and for screen readers. */
  title: string;
}

/** Small printed glyphs, one per kind of mark, drawn on a 12 by 12 grid. */
const GLYPHS: Record<Mark["kind"], string> = {
  // A crescent cupping a star: something cast in the dark.
  hex: `<path d="M8.6 1.6a4.8 4.8 0 1 0 1.8 8.2A3.8 3.8 0 1 1 8.6 1.6z" fill="currentColor"/><path d="M8.4 4.2l.5 1.1 1.1.2-.8.8.2 1.1-1-.5-1 .5.2-1.1-.8-.8 1.1-.2z" fill="currentColor"/>`,
  // A heater shield.
  ward: `<path d="M6 1l4.2 1.6V6c0 2.6-1.8 4.2-4.2 5C3.6 10.2 1.8 8.6 1.8 6V2.6z" fill="currentColor"/><path d="M6 2.6v7" stroke="#0006" stroke-width="0.9"/>`,
  // A card lying face down, with the back's lattice.
  trap: `<rect x="2.2" y="1.4" width="7.6" height="9.2" rx="1" fill="currentColor"/><path d="M3.8 3l4.4 6M8.2 3L3.8 9" stroke="#0007" stroke-width="0.8"/>`,
  // A four-pointed spark.
  boon: `<path d="M6 .8l1.2 3.9 3.9 1.3-3.9 1.2L6 11.2 4.8 7.2.9 6l3.9-1.3z" fill="currentColor"/>`,
};

export function marksFor(view: PlayerView, player: Player): Mark[] {
  const marks: Mark[] = [];
  const turn = view.phase !== "over" && view.current === player;
  if (turn && view.reversing) {
    marks.push({
      kind: "hex",
      label: "Backstep",
      title: "Backstep: the next checker move goes backwards, if one can",
    });
  }
  for (const hex of view.hexes[player]) {
    const { name } = CARDS[hex];
    const persists = hex === "shackles" ? ", on every roll until broken" : " at the next roll";
    marks.push({ kind: "hex", label: name, title: `Hexed by ${name}: bites${persists}` });
  }
  for (const ward of view.wards[player]) {
    const { name } = CARDS[ward];
    const does = ward === "mirror" ? "sends the next hex back" : "blocks the next hex";
    marks.push({ kind: "ward", label: name, title: `${name} stands guard: ${does}` });
  }
  if (player === view.you) {
    for (const trap of view.traps) {
      const { name } = CARDS[trap];
      marks.push({ kind: "trap", label: name, title: `Your ${name} is set, face down` });
    }
  } else {
    const set = view.counts[player].traps;
    if (set > 0) {
      const label = set === 1 ? "Trap set" : `${set} traps set`;
      marks.push({ kind: "trap", label, title: `${label}, face down: it springs on what you do` });
    }
  }
  const bonus = view.bonusDice[player];
  if (bonus > 0) {
    const dice = bonus === 1 ? "die" : "dice";
    marks.push({
      kind: "boon",
      label: `+${bonus} ${dice}`,
      title: `Curse Eater: +${bonus} ${dice} on the next roll`,
    });
  }
  if (view.extraOffer[player]) {
    marks.push({
      kind: "boon",
      label: "Keen Eye",
      title: "Keen Eye: four cards on offer at the next pick",
    });
  }
  return marks;
}

/** The marks as a row of small printed tags, or `null` if there are none. */
export function markRow(marks: Mark[]): HTMLElement | null {
  if (marks.length === 0) return null;
  const row = document.createElement("span");
  row.className = "marks";
  for (const mark of marks) {
    const tag = document.createElement("span");
    tag.className = `mark mark-${mark.kind}`;
    tag.title = mark.title;
    tag.setAttribute("aria-label", mark.title);
    const glyph = document.createElement("span");
    glyph.className = "mark-glyph";
    // Fixed markup from our own source.
    glyph.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true">${GLYPHS[mark.kind]}</svg>`;
    const label = document.createElement("span");
    label.className = "mark-label";
    label.textContent = mark.label;
    tag.append(glyph, label);
    row.append(tag);
  }
  return row;
}
