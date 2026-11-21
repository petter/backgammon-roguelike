import "./marks.css";
import type { Player } from "../core/board.ts";
import { CARDS } from "../core/cards.ts";
import type { PlayerView } from "../core/view.ts";
import { glyph } from "./glyphs.ts";

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

/**
 * The marks as a row of small printed tags, one per kind, or `null` if there are none.
 * Marks of one kind share a tag; on a phone it shows only its glyph and how many.
 */
export function markRow(marks: Mark[]): HTMLElement | null {
  if (marks.length === 0) return null;
  const row = document.createElement("span");
  row.className = "marks";
  const kinds: Array<Mark["kind"]> = ["hex", "ward", "trap", "boon"];
  for (const kind of kinds) {
    const same = marks.filter((mark) => mark.kind === kind);
    if (same.length === 0) continue;
    const tag = document.createElement("span");
    tag.className = `mark mark-${kind}`;
    const title = same.map((mark) => mark.title).join(". ");
    tag.title = title;
    tag.setAttribute("aria-label", title);
    const label = document.createElement("span");
    label.className = "mark-label";
    label.textContent = same.map((mark) => mark.label).join(" · ");
    tag.append(glyph(kind, "mark-glyph"), label);
    if (same.length > 1) {
      const count = document.createElement("span");
      count.className = "mark-count";
      count.textContent = String(same.length);
      tag.append(count);
    }
    row.append(tag);
  }
  return row;
}
