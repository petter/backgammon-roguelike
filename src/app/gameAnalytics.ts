import type { Player } from "../core/board.ts";
import type { CardId } from "../core/cards.ts";
import { isUntouched } from "../core/view.ts";
import type { SessionUpdate } from "../net/session.ts";
import { type GameMode, track } from "./analytics.ts";

/** On one screen both sides are the same people, so there is no winning or losing to report. */
function outcomeOf(mode: GameMode, won: boolean): "won" | "lost" | "local" {
  if (mode === "local") return "local";
  return won ? "won" : "lost";
}

/**
 * Reports what happens in one game from the updates its screen receives. Online, each
 * seat reports only its own cards (the other seat's picks arrive hidden anyway), so a
 * card is counted once; on one screen both sides are reported.
 */
export function gameReporter(mode: GameMode): (update: SessionUpdate) => void {
  /** The cards last offered to each side, to report beside the one picked. */
  const offers: Partial<Record<Player, CardId[]>> = {};
  let seen = false;

  return ({ view, events }) => {
    if (!view) return;
    // A fresh game, not a return to one under way after a reload.
    if (!seen && isUntouched(view)) track("game_started", { mode });
    seen = true;
    const mine = (player: Player) => mode === "local" || player === view.you;
    for (const event of events) {
      if (event.type === "cardsOffered" && event.cards) {
        offers[event.player] = event.cards;
      } else if (event.type === "cardPicked" && event.card && mine(event.player)) {
        track("card_picked", { mode, card: event.card, offered: offers[event.player] ?? [] });
      } else if (
        (event.type === "cardPlayed" || event.type === "trapSet") &&
        event.card &&
        mine(event.player)
      ) {
        track("card_played", { mode, card: event.card });
      } else if (event.type === "gameWon") {
        track("game_finished", {
          mode,
          outcome: outcomeOf(mode, event.winner === view.you),
          reason: view.winReason ?? "bearOff",
          game: view.wins.white + view.wins.black,
        });
      } else if (event.type === "gameStarted") {
        track("rematch_started", { mode });
      }
    }
    // A snapshot, after a reload say, carries the offer without the event that dealt it.
    if (view.offer.length > 0) offers[view.you] = view.offer;
  };
}
