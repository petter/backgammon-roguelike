import type { Player } from "../core/board.ts";
import { CARDS } from "../core/cards.ts";
import type { GameEvent } from "../core/game.ts";
import type { CoinReveal, Reveal } from "../ui/reveal.ts";

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

/**
 * The card to hold up as it is played, so both players see what was done. `who` names a
 * player as the one acting: "You" or "Ada". A trap is set face down, so its owner sees it
 * turn over and the other player sees only its back.
 */
export function playedReveal(event: GameEvent, who: (player: Player) => string): Reveal | null {
  if (event.type === "cardPlayed") {
    return {
      card: event.card,
      kind: "play",
      title: `${who(event.player)} played ${CARDS[event.card].name}`,
    };
  }
  if (event.type === "trapSet") {
    return {
      card: event.card,
      kind: "set",
      title: event.card
        ? `${who(event.player)} set ${CARDS[event.card].name}`
        : `${who(event.player)} set a trap`,
      effect: "Face down",
    };
  }
  return null;
}

/** The coin to toss for a Coin Toss, landing as it fell, with what that does to the roll. */
export function coinReveal(event: GameEvent, whose: (player: Player) => string): CoinReveal | null {
  if (event.type !== "coinFlipped") return null;
  return event.heads
    ? { heads: true, title: "Heads!", effect: `${whose(event.player)} roll gains a die` }
    : { heads: false, title: "Tails", effect: `${whose(event.player)} lowest die is lost` };
}
