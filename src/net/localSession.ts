import { applyCommand, GameError, type GameEvent, newGame } from "../core/game.ts";
import { viewFor } from "../core/view.ts";
import type { Session, SessionHandlers } from "./session.ts";

/** Both seats in one tab, no server. The view always belongs to whoever is on turn. */
export function createLocalSession(handlers: SessionHandlers, seed: number): Session {
  let { state, events } = newGame(seed);
  let closed = false;

  const emit = (happened: GameEvent[]) => {
    if (closed) return;
    handlers.onUpdate({
      lobby: {
        code: "LOCAL",
        you: state.current,
        players: { white: { name: "White" }, black: { name: "Black" } },
      },
      view: viewFor(state, state.current),
      events: happened,
    });
  };
  queueMicrotask(() => {
    if (closed) return;
    handlers.onStatus("connected");
    emit(events);
  });

  return {
    send(command) {
      try {
        ({ state, events } = applyCommand(state, state.current, command));
      } catch (error) {
        if (!(error instanceof GameError)) throw error;
        handlers.onError(error.message, false);
        return;
      }
      emit(events);
    },
    drop() {},
    close() {
      closed = true;
    },
  };
}
