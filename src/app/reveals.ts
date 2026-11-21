import type { Player } from "../core/board.ts";
import { CARDS } from "../core/cards.ts";
import type { GameEvent } from "../core/game.ts";
import type { Reveal } from "../ui/reveal.ts";

/**
 * The card to show for an event that changes the game from a card not just played: a trap
 * springing, or a hex biting at a roll. `whose` names a player as an owner: "Your" or
 * "Ada's". Every other event shows nothing.
 */
export function revealFor(event: GameEvent, whose: (player: Player) => string): Reveal | null {
  if (event.type === "trapSprung") {
    const victim: Player = event.player === "white" ? "black" : "white";
    const effect =
      event.card === "counterpunch"
        ? `${whose(victim)} hitter goes to the bar too`
        : `${whose(victim)} doubles lose a die`;
    return {
      card: event.card,
      kind: "trap",
      title: `${whose(event.player)} ${CARDS[event.card].name} springs!`,
      effect,
    };
  }
  if (event.type === "hexStruck") {
    const effects = {
      leadWeight: "highest die drops by 1",
      shackles: "highest die drops by 1",
      crackedDice: "roll is three dice, highest dropped",
      backstep: "next move goes backwards",
    } as const;
    return {
      card: event.card,
      kind: "hex",
      title: `${CARDS[event.card].name} bites!`,
      effect: `${whose(event.player)} ${effects[event.card]}`,
    };
  }
  return null;
}
