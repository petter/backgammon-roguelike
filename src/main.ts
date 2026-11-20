import "./style.css";
import { legalMoves, newGame, playMove, type Result, roll } from "./core/game";
import { createRng } from "./core/rng";
import { createBoard } from "./render/board";
import { CheckersView } from "./render/checkers";
import { shake, tossAll } from "./render/effects";
import { createStage } from "./render/stage";
import { createHud, playerName } from "./ui/hud";

const stageEl = document.getElementById("stage");
if (!stageEl) throw new Error("Missing #stage");

const seed = Number(new URLSearchParams(location.search).get("seed")) || Date.now() % 1_000_000_000;
const rng = createRng(seed);

let state = newGame();
let selected: number | "bar" | null = null;
let message = "";

const stage = createStage(stageEl);
const board = createBoard();
const checkers = new CheckersView(state.board);
stage.world.add(board.group, checkers.group);
const hud = createHud(seed, rollDice, quake);

/** Redraws everything that depends on state and selection. */
function refresh(): void {
  const moves = legalMoves(state);
  if (state.phase === "move" && state.board.bar[state.current] > 0) selected = "bar";
  const options = moves.filter((m) => m.from === selected);
  board.setTargets(
    options.flatMap((m) => (typeof m.to === "number" ? [m.to] : [])),
    options.some((m) => m.to === "off"),
  );
  if (selected === null) checkers.lift(null);
  else if (selected === "bar") checkers.lift({ kind: "bar", player: state.current });
  else checkers.lift({ kind: "point", index: selected });
  hud.update(state, message);
}

/** Adopts a core result and plays its events back as animation. */
function run(result: Result): void {
  state = result.state;
  selected = null;
  message = "";
  let rolled = "";
  for (const event of result.events) {
    if (event.type === "pieceMoved") {
      checkers.apply(event);
    } else if (event.type === "hit") {
      checkers.apply(event);
      shake(stage.world, 0.6, 0.4);
    } else if (event.type === "diceRolled") {
      rolled = event.dice.slice(0, 2).join("-");
    } else if (event.type === "turnEnded" && event.reason === "blocked") {
      const prefix = rolled ? `${playerName(event.player)} rolled ${rolled}: ` : "";
      message = `${prefix}no legal move, turn passes`;
    }
  }
  refresh();
}

function rollDice(): void {
  if (state.phase === "roll") run(roll(state, rng));
}

/** Stand-in for a card effect: purely visual, to tune the feel. */
function quake(): void {
  shake(stage.world, 1.4);
  tossAll(checkers.all());
}

stageEl.addEventListener("pointerdown", (event) => {
  if (state.phase !== "move") return;
  const target = stage.pick(event.clientX, event.clientY);
  const moves = legalMoves(state);

  if (selected !== null && target && target.kind !== "bar") {
    const to = target.kind === "point" ? target.index : "off";
    // With several dice reaching the same spot, spend the smallest.
    const [move] = moves
      .filter((m) => m.from === selected && m.to === to)
      .sort((a, b) => a.die - b.die);
    if (move) {
      run(playMove(state, move));
      return;
    }
  }

  const from = target?.kind === "point" ? target.index : null;
  selected = from !== null && moves.some((m) => m.from === from) ? from : null;
  refresh();
});

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.code === "Space") {
    event.preventDefault();
    rollDice();
  } else if (event.code === "KeyQ") {
    quake();
  }
});

refresh();
