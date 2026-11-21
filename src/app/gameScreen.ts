import type { Player } from "../core/board.ts";
import { CARDS } from "../core/cards.ts";
import { type GameEvent, legalMoves } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";
import type { LobbyView } from "../net/protocol.ts";
import type { Session, SessionHandlers, SessionUpdate } from "../net/session.ts";
import type { BoardView } from "../render/board.ts";
import { CheckersView } from "../render/checkers.ts";
import { DiceView } from "../render/dice.ts";
import { shake, tossAll } from "../render/effects.ts";
import { obstaclesOf, slotPosition } from "../render/layout.ts";
import type { Stage } from "../render/stage.ts";
import type { Hud } from "../ui/hud.ts";

const COLOR_NAMES = { white: "White", black: "Black" } as const;

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

  const dice = new DiceView();
  stage.world.add(dice.group);
  /** When the dice now in the air will have landed, on the `performance.now()` clock. */
  let landsAt = 0;
  let landing: ReturnType<typeof setTimeout> | undefined;

  const sideOf = (player: Player) => (player === "white" ? 1 : -1);
  /** Doubles are four moves but two dice on the table. */
  const physical = (values: number[]) =>
    values.length === 4 && values.every((value) => value === values[0])
      ? values.slice(0, 2)
      : values;
  /** Throws the dice for a result the server has already decided, then waits for them. */
  const throwDice = (values: number[], player: Player, state: PlayerView["board"]) => {
    const seconds = dice.throw(physical(values), sideOf(player), obstaclesOf(state), Math.random);
    landsAt = performance.now() + seconds * 1000;
    clearTimeout(landing);
    landing = setTimeout(refresh, seconds * 1000 + 30);
  };

  const myTurn = () => view !== null && view.phase !== "over" && view.current === view.you;
  const name = (player: Player) => lobby?.players[player]?.name ?? player;

  /** Redraws everything that depends on the view and the selection. */
  const refresh = () => {
    if (!view || !lobby || !checkers) return;
    // Nothing can be done with a roll until the dice have come to rest.
    const rolling = performance.now() < landsAt;
    const moves = myTurn() && !rolling ? legalMoves(view) : [];
    if (moves.length > 0 && view.board.bar[view.current] > 0) selected = "bar";
    if (!moves.some((m) => m.from === selected)) selected = null;
    const targets = moves.filter((m) => m.from === selected);
    const { board: state, current } = view;
    // A checker lands on top of its own colour, or on the felt of an empty point. When it
    // would hit, it takes the place of the checker that is there now.
    const landing = (point: number) => {
      const there = state.points[point];
      const mine = there.owner === current;
      return {
        point,
        at: slotPosition({ kind: "point", index: point }, mine ? there.count : 0),
        occupied: !mine && there.count > 0,
      };
    };
    const top = (from: number | "bar") =>
      from === "bar"
        ? slotPosition({ kind: "bar", player: current }, state.bar[current] - 1)
        : slotPosition({ kind: "point", index: from }, state.points[from].count - 1);
    const reachable = [
      ...new Set(targets.flatMap((m) => (typeof m.to === "number" ? [m.to] : []))),
    ];
    board.setHints({
      // Until a checker is picked, show which ones can move at all.
      sources: selected === null ? [...new Set(moves.map((m) => m.from))].map(top) : [],
      targets: reachable.map(landing),
      off: targets.some((m) => m.to === "off"),
    });
    if (selected === null) checkers.lift(null);
    else if (selected === "bar") checkers.lift({ kind: "bar", player: view.current });
    else checkers.lift({ kind: "point", index: selected });
    hud.render({
      view,
      lobby,
      myTurn: myTurn(),
      canEnd: myTurn() && !rolling && view.phase === "move" && moves.length === 0,
      rolling,
      local: options.local,
      message,
      status,
    });
  };

  /** Plays events back as animation and returns the line to show for them, if any. */
  const play = (events: GameEvent[], pieces: CheckersView, next: PlayerView): string => {
    const you = next.you;
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
      } else if (event.type === "diceRolled") {
        throwDice(event.dice, event.player, next.board);
      } else if (event.type === "diceChanged") {
        // A card changed the dice: throw them again, landing on the new values.
        throwDice(event.dice, event.player, next.board);
        if (event.doubled && text) text += ": doubles!";
      } else if (event.type === "turnEnded") {
        dice.clear();
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
    const starting = !view;
    if (starting) {
      options.onStarted();
      if (!options.local) stage.setSeat(update.view.you);
    }
    message = "";
    if (!checkers) {
      checkers = new CheckersView(update.view.board);
      stage.world.add(checkers.group);
    } else {
      message = play(update.events, checkers, update.view);
    }
    // Dice belong to the move phase. Joining or resyncing mid-turn, set them down as rolled.
    const { phase, dice: remaining, current } = update.view;
    if (phase !== "move") dice.clear();
    else if (dice.count === 0 && remaining.length > 0) {
      dice.show(physical(remaining), sideOf(current));
    }
    if (starting && !options.local) message = `You are playing ${COLOR_NAMES[update.view.you]}`;
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
      if (performance.now() < landsAt) return;
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
    board.setHints();
    if (checkers) stage.world.remove(checkers.group);
    clearTimeout(landing);
    dice.clear();
    stage.world.remove(dice.group);
    stage.setSeat("white");
  };
}
