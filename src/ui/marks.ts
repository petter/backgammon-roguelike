import type { Player } from "../core/board.ts";
import { CARDS, type CardId } from "../core/cards.ts";
import type { PlayerView } from "../core/view.ts";

/**
 * A card lying on the table in front of a player beside their checkers: a hex waiting to
 * bite them, a ward standing guard, a trap set face down, or a boon still to come.
 */
export interface Mark {
  kind: "hex" | "ward" | "trap" | "boon";
  /** The card that lies there. `null` for the opponent's trap, which is seen only from the back. */
  card: CardId | null;
  /** Lies face down: a trap. Its owner may still look at it. */
  faceDown: boolean;
  /** What to call it: the card's name, or "A trap" when that is secret. */
  label: string;
  /** What it does now, in a line. */
  title: string;
}

export function marksFor(view: PlayerView, player: Player): Mark[] {
  const marks: Mark[] = [];
  const mark = (kind: Mark["kind"], card: CardId, title: string) =>
    marks.push({ kind, card, faceDown: false, label: CARDS[card].name, title });
  const turn = view.phase !== "over" && view.current === player;
  if (turn && view.reversing) {
    mark("hex", "backstep", "Bites now: the next checker move goes backwards, if one can.");
  }
  for (const hex of view.hexes[player]) {
    mark(
      "hex",
      hex,
      hex === "shackles"
        ? "A hex. Bites at every roll until it is broken by a hit or by doubles."
        : "A hex. Bites at the next roll.",
    );
  }
  for (const ward of view.wards[player]) {
    mark(
      "ward",
      ward,
      ward === "mirror"
        ? "A ward. Throws the next hex back at whoever cast it."
        : "A ward. Blocks the next hex.",
    );
  }
  if (view.shielded[player]) {
    mark("boon", "shield", "Lone checkers cannot be hit until this player's next turn.");
  }
  const bonus = view.bonusDice[player];
  if (bonus > 0) {
    const dice = bonus === 1 ? "die" : "dice";
    mark("boon", "curseEater", `+${bonus} ${dice} on the next roll.`);
  }
  if (view.extraOffer[player]) mark("boon", "keenEye", "Four cards on offer at the next pick.");
  if (player === view.you) {
    for (const trap of view.traps) {
      marks.push({
        kind: "trap",
        card: trap,
        faceDown: true,
        label: CARDS[trap].name,
        title: "Set face down. Only its owner knows which trap it is.",
      });
    }
  } else {
    for (let i = 0; i < view.counts[player].traps; i++) {
      marks.push({
        kind: "trap",
        card: null,
        faceDown: true,
        label: "A trap",
        title:
          "Set face down. It springs on something the other player does, and only then shows which it is.",
      });
    }
  }
  return marks;
}
