import { cardBlock } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";

/**
 * Whether the dice are thrown for the player without waiting for Roll: it is their roll,
 * and nothing in their hand can be played before it. Only a cleansing ward, with a hex
 * waiting on them, can be; then the choice to play it first is theirs.
 */
export function rollsByItself(view: PlayerView): boolean {
  if (view.phase !== "roll" || view.current !== view.you) return false;
  return !view.hand.some((card) => cardBlock(view, card, view.traps) === null);
}
