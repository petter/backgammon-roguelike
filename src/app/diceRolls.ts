import type { GameEvent } from "../core/game.ts";
import type { DiceRoll } from "../render/dice.ts";

/** Doubles are four moves but two dice on the table. */
export const physical = (values: number[]) =>
  values.length === 4 && values.every((value) => value === values[0]) ? values.slice(0, 2) : values;

/** Events hexes add between a roll and the change they make to it. */
const biting = (event: GameEvent | undefined) =>
  event?.type === "hexStruck" || event?.type === "hexLifted";

/**
 * The change hexes made to a roll as it was thrown: the `diceChanged` that follows `rolled`
 * with only the hexes' own events between. None when nothing changed it.
 */
export function rollBitten(
  events: GameEvent[],
  rolled: GameEvent,
): Extract<GameEvent, { type: "diceChanged" }> | null {
  let at = events.indexOf(rolled) + 1;
  while (biting(events[at])) at++;
  const next = events[at];
  return at > 0 && next?.type === "diceChanged" ? next : null;
}

/** Whether `changed` is hexes biting the roll just before it, which its throw already shows. */
export function bitesRoll(events: GameEvent[], changed: GameEvent): boolean {
  let at = events.indexOf(changed) - 1;
  while (biting(events[at])) at--;
  return events[at]?.type === "diceRolled";
}

/**
 * The throw to make for a roll or a change to it. Hexes biting a roll change its thrown dice
 * in front of the viewer, so the change they make throws nothing of its own.
 */
export function throwFor(events: GameEvent[], event: GameEvent): DiceRoll | null {
  if (event.type === "diceRolled") {
    return { thrown: event.dice, played: rollBitten(events, event)?.dice };
  }
  if (event.type === "diceChanged" && !bitesRoll(events, event)) return { thrown: event.dice };
  return null;
}
