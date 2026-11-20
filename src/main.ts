import "./style.css";
import { runGame } from "./app/gameScreen.ts";
import { seedFromQuery } from "./app/seed.ts";
import { createLocalSession } from "./net/localSession.ts";
import { codeFromPath, type SeatGrant } from "./net/protocol.ts";
import { createRemoteSession } from "./net/remoteSession.ts";
import { createBoard } from "./render/board.ts";
import { createStage } from "./render/stage.ts";
import { el } from "./ui/dom.ts";
import { createHud } from "./ui/hud.ts";
import { createLobbyUi } from "./ui/lobby.ts";

const stageEl = el("stage");
const stage = createStage(stageEl);
const board = createBoard();
stage.world.add(board.group);
const hud = createHud();
const deps = { stageEl, stage, board, hud };

let stopGame: (() => void) | null = null;

/** Seat tokens live in sessionStorage: per tab, so two tabs can be two players. */
const seats = {
  get(code: string): string | null {
    try {
      return sessionStorage.getItem(`seat:${code}`);
    } catch {
      return null;
    }
  },
  set(code: string, token: string): void {
    try {
      sessionStorage.setItem(`seat:${code}`, token);
    } catch {
      // Without storage the seat still works until the tab is reloaded.
    }
  },
  forget(code: string): void {
    try {
      sessionStorage.removeItem(`seat:${code}`);
    } catch {
      // Nothing to forget.
    }
  },
};

function leaveGame(): void {
  stopGame?.();
  stopGame = null;
  hud.hide();
}

function startRemote(code: string, token: string): void {
  leaveGame();
  stopGame = runGame(deps, {
    local: false,
    connect: (handlers) => createRemoteSession(code, token, handlers),
    onWaiting: () => lobby.showWaiting(code, `${location.origin}/g/${code}`),
    onStarted: () => {
      lobby.hide();
      hud.show();
    },
    onFatal: (message) => {
      seats.forget(code);
      leaveGame();
      history.replaceState(null, "", "/");
      lobby.showMenu({ error: message });
    },
  });
}

function startLocal(): void {
  leaveGame();
  const seed = seedFromQuery(location.search, Date.now());
  stopGame = runGame(deps, {
    local: true,
    connect: (handlers) => createLocalSession(handlers, seed),
    onWaiting: () => {},
    onStarted: () => {
      lobby.hide();
      hud.show();
    },
    onFatal: (message) => lobby.showMenu({ error: message }),
  });
}

/** Asks the server for a seat, then enters the room. */
async function takeSeat(path: string, name: string): Promise<void> {
  lobby.setBusy(true);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await response.json()) as Partial<SeatGrant> & { error?: string };
    if (!response.ok || !body.code || !body.token) {
      lobby.showMenu({ error: body.error ?? "Could not reach the game server" });
      return;
    }
    seats.set(body.code, body.token);
    history.pushState(null, "", `/g/${body.code}`);
    startRemote(body.code, body.token);
  } catch {
    lobby.showMenu({ error: "Could not reach the game server" });
  } finally {
    lobby.setBusy(false);
  }
}

const lobby = createLobbyUi({
  onCreate: (name) => void takeSeat("/api/rooms", name),
  onJoin: (code, name) => void takeSeat(`/api/rooms/${code}/join`, name),
  onLocal: startLocal,
});

function route(): void {
  leaveGame();
  const code = codeFromPath(location.pathname);
  const token = code ? seats.get(code) : null;
  if (code && token) startRemote(code, token);
  else lobby.showMenu({ code: code ?? undefined });
}

window.addEventListener("popstate", route);
route();
