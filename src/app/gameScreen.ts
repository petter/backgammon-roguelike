import type { Player } from "../core/board.ts";
import { CARDS } from "../core/cards.ts";
import { type GameEvent, legalMoves } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";
import type { LobbyView } from "../net/protocol.ts";
import type { Session, SessionHandlers, SessionUpdate } from "../net/session.ts";
import type { BoardView } from "../render/board.ts";
import { CheckersView } from "../render/checkers.ts";
import { shake, tossAll } from "../render/effects.ts";
import type { Stage } from "../render/stage.ts";
import type { Hud } from "../ui/hud.ts";

export interface GameScreenDeps {
  stageEl: HTMLElement;
  stage: Stage;
  board: BoardView;
  hud: Hud;
}

export interface GameScreenOptions {
  /** Hot-seat: both players use this screen, so the camera stays put. */
  local: boolean;
  connect(handlers: SessionHandlers): Session;
  /** The room exists but the second player has not joined. */
  onWaiting(lobby: LobbyView): void;
  onStarted(): void;
  /** The session ended for good, for example because the room is gone. */
  onFatal(message: string): void;
}

/**
 * Drives one game: turns session updates into animation and HUD state, and pointer and key
 * input into commands. Returns a function that tears it all down.
 */
export function runGame(deps: GameScreenDeps, options: GameScreenOptions): () => void {
  const { stageEl, stage, board, hud } = deps;
  const listeners = new AbortController();
  let view: PlayerView | null = null;
  let lobby: LobbyView | null = null;
  let checkers: CheckersView | null = null;
  let selected: number | "bar" | null = null;
  let message = "";
  let status = "";

  const myTurn = () => view !== null && view.phase !== "over" && view.current === view.you;
  const name = (player: Player) => lobby?.players[player]?.name ?? player;

  /** Redraws everything that depends on the view and the selection. */
  const refresh = () => {
    if (!view || !lobby || !checkers) return;
    const moves = myTurn() ? legalMoves(view) : [];
    if (moves.length > 0 && view.board.bar[view.current] > 0) selected = "bar";
    if (!moves.some((m) => m.from === selected)) selected = null;
    const targets = moves.filter((m) => m.from === selected);
    board.setTargets(
      targets.flatMap((m) => (typeof m.to === "number" ? [m.to] : [])),
      targets.some((m) => m.to === "off"),
    );
    if (selected === null) checkers.lift(null);
    else if (selected === "bar") checkers.lift({ kind: "bar", player: view.current });
    else checkers.lift({ kind: "point", index: selected });
    hud.render({
      view,
      lobby,
      myTurn: myTurn(),
      canEnd: myTurn() && view.phase === "move" && moves.length === 0,
      local: options.local,
      message,
      status,
    });
  };

  /** Plays events back as animation and returns the line to show for them, if any. */
  const play = (events: GameEvent[], pieces: CheckersView, you: Player): string => {
    let text = "";
    let quaked = false;
    for (const event of events) {
      if (event.type === "pieceMoved") {
        pieces.apply(event);
      } else if (event.type === "hit") {
        pieces.apply(event);
        // A quake already shook the board; a second shake would cut it short.
        if (!quaked) shake(stage.world, 0.6, 0.4);
      } else if (event.type === "cardPlayed") {
        text = `${name(event.player)} played ${CARDS[event.card].name}`;
        if (event.card === "quake") {
          quaked = true;
          shake(stage.world, 1.4);
          tossAll(pieces.all());
        }
      } else if (event.type === "diceChanged" && event.dice.length === 4 && text) {
        // A card can only leave four dice by turning a pair into doubles.
        text += ": doubles!";
      } else if (event.type === "cardPicked" && event.player !== you) {
        text = `${name(event.player)} picked a card`;
      }
    }
    return text;
  };

  const onUpdate = (update: SessionUpdate) => {
    lobby = update.lobby;
    if (!update.view) {
      options.onWaiting(update.lobby);
      return;
    }
    if (!view) {
      options.onStarted();
      if (!options.local) stage.setSeat(update.view.you);
    }
    message = "";
    if (!checkers) {
      checkers = new CheckersView(update.view.board);
      stage.world.add(checkers.group);
    } else {
      message = play(update.events, checkers, update.view.you);
    }
    // Missed or unexpected events: snap to the truth instead of drifting.
    if (!checkers.matches(update.view.board)) checkers.reset(update.view.board);
    view = update.view;
    selected = null;
    refresh();
  };

  const session = options.connect({
    onUpdate,
    onError(text, fatal) {
      if (fatal) return options.onFatal(text);
      message = text;
      refresh();
    },
    onStatus(next) {
      status = next === "reconnecting" ? "Reconnecting…" : "";
      refresh();
    },
  });

  const roll = () => {
    if (myTurn() && view?.phase === "roll") session.send({ type: "roll" });
  };
  const end = () => {
    if (myTurn() && view?.phase === "move") session.send({ type: "endTurn" });
  };
  hud.actions = {
    onRoll: roll,
    onEnd: end,
    onPlay: (index) => session.send({ type: "playCard", index }),
    onPick: (index) => session.send({ type: "pickCard", index }),
  };

  stageEl.addEventListener(
    "pointerdown",
    (event) => {
      if (!view || !myTurn() || view.phase !== "move") return;
      const target = stage.pick(event.clientX, event.clientY);
      const moves = legalMoves(view);

      if (selected !== null && target && target.kind !== "bar") {
        const to = target.kind === "point" ? target.index : "off";
        // With several dice reaching the same spot, spend the smallest.
        const [move] = moves
          .filter((m) => m.from === selected && m.to === to)
          .sort((a, b) => a.die - b.die);
        if (move) {
          session.send({ type: "move", from: move.from, to: move.to, die: move.die });
          selected = null;
          refresh();
          return;
        }
      }
      selected = target?.kind === "point" ? target.index : null;
      refresh();
    },
    { signal: listeners.signal },
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat || event.target instanceof HTMLInputElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        roll();
      } else if (event.code === "KeyE") {
        end();
      } else if (event.code === "KeyD" && import.meta.env.DEV) {
        // Development only: fake a dropped connection.
        session.drop();
      }
    },
    { signal: listeners.signal },
  );

  return () => {
    session.close();
    listeners.abort();
    hud.actions = null;
    board.setTargets([], false);
    if (checkers) stage.world.remove(checkers.group);
    stage.setSeat("white");
  };
}
