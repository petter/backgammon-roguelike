import type { GameState } from "../core/game";

const NAMES = { white: "White", black: "Black" } as const;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

export interface Hud {
  update(state: GameState, message: string): void;
}

export function createHud(seed: number, onRoll: () => void, onQuake: () => void): Hud {
  const turn = el("turn");
  const dice = el("dice");
  const messageEl = el("message");
  const roll = el<HTMLButtonElement>("roll");
  el("seed").textContent = `seed ${seed}`;
  roll.addEventListener("click", onRoll);
  el("quake").addEventListener("click", onQuake);

  return {
    update(state, message) {
      turn.textContent =
        state.phase === "over" && state.winner
          ? `${NAMES[state.winner]} wins`
          : `${NAMES[state.current]} to ${state.phase}`;
      // U+2680 is die face 1; the six faces are consecutive.
      dice.textContent = state.dice.map((d) => String.fromCodePoint(0x267f + d)).join("");
      messageEl.textContent = message;
      roll.disabled = state.phase !== "roll";
    },
  };
}

export function playerName(player: keyof typeof NAMES): string {
  return NAMES[player];
}
