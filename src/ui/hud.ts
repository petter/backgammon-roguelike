import type { Player } from "../core/board.ts";
import { CHARACTERS, type CharacterId, DEFAULT_CHARACTER } from "../core/characters.ts";
import { cardBlock } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";
import type { LobbyView } from "../net/protocol.ts";
import { createCard, fanCard } from "./card.ts";
import { characterArt } from "./characterArt.ts";
import { el } from "./dom.ts";

export interface HudActions {
  onRoll: () => void;
  onEnd: () => void;
  onPlay: (handIndex: number) => void;
  /** The player tried a card that cannot be played now; `reason` says why. */
  onBlocked: (reason: string) => void;
  onPick: (offerIndex: number) => void;
  /** Asks to play again once the game is over. */
  onRematch: () => void;
  /** Goes back to the start screen. */
  onLeave: () => void;
}

export interface HudModel {
  view: PlayerView;
  lobby: LobbyView;
  /** Whether the viewer may act now. */
  myTurn: boolean;
  /** Whether ending the turn is allowed: rolled, and no move left. */
  canEnd: boolean;
  /** The dice are still in the air: their result is not shown or usable yet. */
  rolling: boolean;
  /** Both seats share this screen, so name the player instead of saying "you". */
  local: boolean;
  message: string;
}

export interface Hud {
  /** Swapped out when a new game starts. */
  actions: HudActions | null;
  render: (model: HudModel) => void;
  /** Tells the player something briefly, without redrawing anything. */
  notify: (text: string) => void;
  /** Shows or hides the banner that says the connection to the server is lost. */
  setOffline: (offline: boolean) => void;
  show: () => void;
  hide: () => void;
}

/**
 * A hand card grows to full size when pointed at. This works out how far it must slide
 * sideways so that the full-size card stays inside the window, and hands that to the CSS.
 */
function keepOnScreen(card: HTMLElement): void {
  const margin = 8;
  const half = card.offsetWidth / 2;
  // Layout position, which the scaling does not move: the card grows about this centre.
  const origin = card.offsetParent?.getBoundingClientRect().left ?? 0;
  const centre = origin + card.offsetLeft + half;
  const least = margin + half - centre;
  const most = window.innerWidth - margin - half - centre;
  card.style.setProperty("--shift", `${Math.max(least, Math.min(0, most))}px`);
}

interface ChipModel {
  player: Player;
  name: string;
  character: CharacterId;
  wins: number;
  /** Whether any game of this match has been won yet; until then no score is shown. */
  scored: boolean;
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
  const portrait = document.createElement("span");
  portrait.className = "portrait";
  portrait.title = CHARACTERS[model.character].name;
  portrait.innerHTML = characterArt(model.character);
  const label = document.createElement("strong");
  label.textContent = model.you ? `${model.name} (you)` : model.name;
  const colour = document.createElement("span");
  const colourName = model.player === "white" ? "White" : "Black";
  // In hot-seat play the players are simply called White and Black; do not say it twice.
  colour.textContent = model.name === colourName ? "" : colourName;
  const details = document.createElement("span");
  details.className = "quiet";
  const cards = `${model.hand} ${model.hand === 1 ? "card" : "cards"}`;
  details.textContent = model.shielded ? `${cards}, shielded` : cards;
  chip.append(portrait, dot, label, colour, details);
  if (model.scored) {
    const wins = document.createElement("span");
    wins.className = "wins";
    wins.textContent = String(model.wins);
    wins.title = `${model.wins} ${model.wins === 1 ? "game" : "games"} won`;
    chip.append(wins);
  }
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
  const opponentHand = el("opponent-hand");
  const offlineBanner = el("offline");
  const roll = el("roll", HTMLButtonElement);
  const end = el("end", HTMLButtonElement);
  const hand = el("hand");
  const offer = el("offer");
  const offerCards = el("offer-cards");
  const notice = el("notice");
  const gameOver = el("gameover");
  const result = el("result");
  const score = el("score");
  const rematch = el("rematch", HTMLButtonElement);
  const rematchStatus = el("rematch-status");
  /** The hand card a touch has raised to be read, and the hand it belongs to. */
  let raised: { index: number; hand: string } | null = null;
  /** What kind of pointer last pressed a hand card: "touch", "pen", "mouse" or nothing. */
  let pressedWith = "";
  const lower = () => {
    raised = null;
    for (const card of hand.children) card.classList.remove("card-raised");
  };
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const hud: Hud = {
    actions: null,
    render(model) {
      const { view, lobby, myTurn } = model;
      const name = (player: Player) => lobby.players[player]?.name ?? player;
      const other: Player = view.you === "white" ? "black" : "white";

      turn.textContent = turnText(model, name);
      // U+2680 is die face 1; the six faces are consecutive.
      dice.textContent = model.rolling
        ? ""
        : view.dice.map((d) => String.fromCodePoint(0x267f + d)).join("");
      message.textContent = model.message;
      // Your own chip first; in hot-seat play the order stays fixed.
      const order: Player[] = model.local ? ["white", "black"] : [view.you, other];
      players.replaceChildren(
        ...order.map((player) =>
          playerChip({
            player,
            name: name(player),
            character: lobby.players[player]?.character ?? DEFAULT_CHARACTER,
            wins: view.wins[player],
            scored: view.wins.white + view.wins.black > 0,
            you: !model.local && player === view.you,
            active: view.phase !== "over" && view.current === player,
            hand: view.counts[player].hand,
            shielded: view.shielded[player],
          }),
        ),
      );

      // The opponent's hand, face down: how many cards, never which ones or how rare.
      const held = view.counts[other].hand;
      opponentHand.replaceChildren(
        ...Array.from({ length: held }, () => {
          const back = document.createElement("span");
          back.className = "card-back";
          return back;
        }),
      );
      opponentHand.setAttribute(
        "aria-label",
        `${name(other)} holds ${held} ${held === 1 ? "card" : "cards"}`,
      );

      roll.disabled = !(myTurn && view.phase === "roll");
      end.disabled = !model.canEnd;

      // A raised card stays raised through a redraw, as long as it is still the same hand.
      const handKey = view.hand.join(",");
      if (raised && raised.hand !== handKey) raised = null;
      hand.replaceChildren(
        ...view.hand.map((card, index) => {
          // Why this card cannot be played now, if it cannot. Such a card still takes
          // clicks and key presses, so that trying it says why instead of doing nothing.
          const turnName = name(view.current);
          let blocked: string | null = `It is ${turnName}'s turn`;
          if (myTurn) blocked = model.rolling ? "Wait for the dice to land" : cardBlock(view, card);
          else if (view.phase === "over") blocked = "The game is over";
          const button = createCard(card, () => {
            // A finger cannot point at a card without pressing it, so the first tap only
            // raises the card to be read; the second one plays it.
            const touched = pressedWith === "touch" || pressedWith === "pen";
            pressedWith = "";
            if (touched && raised?.index !== index) {
              lower();
              raised = { index, hand: handKey };
              keepOnScreen(button);
              button.classList.add("card-raised");
              return;
            }
            if (blocked) hud.actions?.onBlocked(blocked);
            else hud.actions?.onPlay(index);
          });
          fanCard(button, index, view.hand.length);
          button.addEventListener("pointerdown", (event) => {
            pressedWith = event.pointerType;
          });
          // A press that never becomes a click must not colour the next key press.
          button.addEventListener("pointercancel", () => {
            pressedWith = "";
          });
          button.addEventListener("keydown", () => {
            pressedWith = "";
          });
          if (raised?.index === index) button.classList.add("card-raised");
          button.addEventListener("pointerenter", () => keepOnScreen(button));
          button.addEventListener("focus", () => keepOnScreen(button));
          if (blocked) {
            button.classList.add("card-blocked");
            button.setAttribute("aria-disabled", "true");
            button.title = blocked;
          }
          return button;
        }),
      );
      for (const card of hand.querySelectorAll<HTMLElement>(".card-raised")) keepOnScreen(card);

      const over = view.phase === "over";
      gameOver.hidden = !over;
      if (over) {
        result.textContent = turnText(model, name);
        score.textContent = `${name("white")} ${view.wins.white} \u2013 ${view.wins.black} ${name("black")}`;
        const asked = view.rematch[view.you];
        rematch.textContent = model.local ? "Play again" : "Rematch";
        rematch.disabled = asked;
        let status = "";
        if (asked) status = `Waiting for ${name(other)}\u2026`;
        else if (view.rematch[other]) status = `${name(other)} wants a rematch`;
        rematchStatus.textContent = status;
      }

      const picking = myTurn && view.phase === "pick" && view.offer.length > 0;
      offer.hidden = !picking;
      offerCards.replaceChildren(
        ...(picking
          ? view.offer.map((card, index) =>
              createCard(card, () => hud.actions?.onPick(index), true),
            )
          : []),
      );
    },
    notify(text) {
      notice.textContent = text;
      notice.hidden = false;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice.hidden = true;
      }, 3500);
    },
    setOffline(offline) {
      offlineBanner.hidden = !offline;
      root.classList.toggle("offline", offline);
    },
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
      offer.hidden = true;
      gameOver.hidden = true;
      raised = null;
      notice.hidden = true;
      offlineBanner.hidden = true;
      root.classList.remove("offline");
    },
  };
  roll.addEventListener("click", () => hud.actions?.onRoll());
  end.addEventListener("click", () => hud.actions?.onEnd());
  rematch.addEventListener("click", () => hud.actions?.onRematch());
  el("leave").addEventListener("click", () => hud.actions?.onLeave());
  // A tap anywhere else puts a raised card back.
  document.addEventListener("pointerdown", (event) => {
    if (raised && !(event.target instanceof Element && event.target.closest("#hand .card")))
      lower();
  });
  return hud;
}
