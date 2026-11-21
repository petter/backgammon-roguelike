import "./style.css";
import { startAnalytics } from "./app/analytics.ts";
import { runGame } from "./app/gameScreen.ts";
import { seedFromQuery } from "./app/seed.ts";
import { createLocalSession } from "./net/localSession.ts";
import { codeFromPath, type RoomStatus, type SeatGrant } from "./net/protocol.ts";
import { createRemoteSession } from "./net/remoteSession.ts";
import { createBoard } from "./render/board.ts";
import { createStage } from "./render/stage.ts";
import { el } from "./ui/dom.ts";
import { createHud } from "./ui/hud.ts";
import { createLobbyUi, type PlayerChoice } from "./ui/lobby/lobby.ts";

startAnalytics();

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

/** Back to the start screen. The seat is kept, so the browser's Back button returns to the game. */
function toMenu(): void {
  leaveGame();
  if (location.pathname !== "/") history.pushState(null, "", "/");
  lobby.showMenu();
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
    onLeave: toMenu,
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
    onLeave: toMenu,
  });
}

/** Refusals that are about the code itself: no game has it, or its game is full. */
const CODE_ERRORS: Partial<Record<number, "missing" | "full">> = { 404: "missing", 409: "full" };

/** Asks the server for a seat, then enters the room. */
async function takeSeat(path: string, player: PlayerChoice): Promise<void> {
  lobby.setBusy(true);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(player),
    });
    const body = (await response.json()) as Partial<SeatGrant> & { error?: string };
    if (!response.ok || !body.code || !body.token) {
      // No such game, or it is full: the code is what to look at again.
      const codeError = CODE_ERRORS[response.status];
      lobby.showMenu({ error: body.error ?? "Could not reach the game server", codeError });
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
  onCreate: (player) => void takeSeat("/api/rooms", player),
  onJoin: (code, player) => void takeSeat(`/api/rooms/${code}/join`, player),
  onLocal: startLocal,
  onCancel: toMenu,
});

/** Looks up an invite's room as the guest arrives, so a dead link says so straight away. */
async function checkInvite(code: string): Promise<void> {
  try {
    const response = await fetch(`/api/rooms/${code}`);
    if (response.status === 404) return lobby.inviteClosed("missing");
    if (!response.ok) return;
    const { status } = (await response.json()) as { status?: RoomStatus };
    if (status === "full") lobby.inviteClosed("full");
  } catch {
    // Offline or unreachable: joining will say so when they try.
  }
}

// The board is scenery while the start screen is up, and the playing surface once it is not.
const lobbyEl = el("lobby");
new MutationObserver(() => stage.setBackdrop(!lobbyEl.hidden)).observe(lobbyEl, {
  attributes: true,
  attributeFilter: ["hidden"],
});

function route(): void {
  leaveGame();
  const code = codeFromPath(location.pathname);
  const token = code ? seats.get(code) : null;
  if (code && token) startRemote(code, token);
  else {
    lobby.showMenu({ code: code ?? undefined });
    if (code) void checkInvite(code);
  }
}

window.addEventListener("popstate", route);
route();
