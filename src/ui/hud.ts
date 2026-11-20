import type { Player } from "../core/board.ts";
import { CARDS, type CardId } from "../core/cards.ts";
import { canPlayCard } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";
import type { LobbyView } from "../net/protocol.ts";
import { el } from "./dom.ts";

export interface HudActions {
  onRoll(): void;
  onEnd(): void;
  onPlay(handIndex: number): void;
  onPick(offerIndex: number): void;
}

export interface HudModel {
  view: PlayerView;
  lobby: LobbyView;
  /** Whether the viewer may act now. */
  myTurn: boolean;
  /** Whether ending the turn is allowed: rolled, and no move left. */
  canEnd: boolean;
  /** Both seats share this screen, so name the player instead of saying "you". */
  local: boolean;
  message: string;
  status: string;
}

export interface Hud {
  /** Swapped out when a new game starts. */
  actions: HudActions | null;
  render(model: HudModel): void;
  show(): void;
  hide(): void;
}

function cardButton(card: CardId, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card";
  const title = document.createElement("strong");
  title.textContent = CARDS[card].name;
  const text = document.createElement("span");
  text.textContent = CARDS[card].text;
  button.append(title, text);
  button.addEventListener("click", onClick);
  return button;
}

interface ChipModel {
  player: Player;
  name: string;
  you: boolean;
  active: boolean;
  hand: number;
  shielded: boolean;
}

/** One player's colour, name and state. The player on turn is outlined. */
function playerChip(model: ChipModel): HTMLElement {
  const chip = document.createElement("div");
  chip.className = `player${model.active ? " active" : ""}`;
  const dot = document.createElement("span");
  dot.className = `dot ${model.player}`;
  const label = document.createElement("strong");
  label.textContent = model.you ? `${model.name} (you)` : model.name;
  const colour = document.createElement("span");
  colour.textContent = model.player === "white" ? "White" : "Black";
  const details = document.createElement("span");
  details.className = "quiet";
  const cards = `${model.hand} ${model.hand === 1 ? "card" : "cards"}`;
  details.textContent = model.shielded ? `${cards}, shielded` : cards;
  chip.append(dot, label, colour, details);
  return chip;
}

function turnText(model: HudModel, name: (player: Player) => string): string {
  const { view, myTurn, local } = model;
  if (view.phase === "over" && view.winner) {
    return !local && view.winner === view.you ? "You win!" : `${name(view.winner)} wins`;
  }
  const doing = { pick: "pick a card", roll: "roll", move: "move", over: "" }[view.phase];
  if (!myTurn) return `Waiting for ${name(view.current)} to ${doing}`;
  return local ? `${name(view.current)}: ${doing}` : `Your turn: ${doing}`;
}

export function createHud(): Hud {
  const root = el("hud");
  const turn = el("turn");
  const dice = el("dice");
  const message = el("message");
  const players = el("players");
  const status = el("status");
  const roll = el<HTMLButtonElement>("roll");
  const end = el<HTMLButtonElement>("end");
  const hand = el("hand");
  const offer = el("offer");
  const offerCards = el("offer-cards");

  const hud: Hud = {
    actions: null,
    render(model) {
      const { view, lobby, myTurn } = model;
      const name = (player: Player) => lobby.players[player]?.name ?? player;
      const other: Player = view.you === "white" ? "black" : "white";

      turn.textContent = turnText(model, name);
      // U+2680 is die face 1; the six faces are consecutive.
      dice.textContent = view.dice.map((d) => String.fromCodePoint(0x267f + d)).join("");
      message.textContent = model.message;
      status.textContent = model.status;
      // Your own chip first; in hot-seat play the order stays fixed.
      const order: Player[] = model.local ? ["white", "black"] : [view.you, other];
      players.replaceChildren(
        ...order.map((player) =>
          playerChip({
            player,
            name: name(player),
            you: !model.local && player === view.you,
            active: view.phase !== "over" && view.current === player,
            hand: view.counts[player].hand,
            shielded: view.shielded[player],
          }),
        ),
      );

      roll.disabled = !(myTurn && view.phase === "roll");
      end.disabled = !model.canEnd;

      hand.replaceChildren(
        ...view.hand.map((card, index) => {
          const button = cardButton(card, () => hud.actions?.onPlay(index));
          button.disabled = !(myTurn && canPlayCard(view, card));
          return button;
        }),
      );
      const picking = myTurn && view.phase === "pick" && view.offer.length > 0;
      offer.hidden = !picking;
      offerCards.replaceChildren(
        ...(picking
          ? view.offer.map((card, index) => cardButton(card, () => hud.actions?.onPick(index)))
          : []),
      );
    },
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
      offer.hidden = true;
    },
  };
  roll.addEventListener("click", () => hud.actions?.onRoll());
  end.addEventListener("click", () => hud.actions?.onEnd());
  return hud;
}
