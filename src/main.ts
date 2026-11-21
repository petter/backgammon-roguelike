import "./style.css";
import { startAnalytics } from "./app/analytics.ts";
import { runGame } from "./app/gameScreen.ts";
import { seedFromQuery } from "./app/seed.ts";
import { initialBoard } from "./core/board.ts";
import { createLocalSession } from "./net/localSession.ts";
import { findMatch, type Search } from "./net/matchmaking.ts";
import { codeFromPath, type RoomStatus, type SeatGrant } from "./net/protocol.ts";
import { createRemoteSession } from "./net/remoteSession.ts";
import { createBoard } from "./render/board.ts";
import { CheckersView } from "./render/checkers.ts";
import { createStage } from "./render/stage.ts";
import { createCoach } from "./ui/coach.ts";
import { el } from "./ui/dom.ts";
import { createHud } from "./ui/hud.ts";
import { createLobbyUi, type PlayerChoice } from "./ui/lobby/lobby.ts";

startAnalytics();

const stageEl = el("stage");
const stage = createStage(stageEl);
const board = createBoard();
stage.world.add(board.group);
const hud = createHud();
const coach = createCoach();
const deps = { stageEl, stage, board, hud, coach };

let stopGame: (() => void) | null = null;
/** The search for a stranger, while one is running. */
let search: Search | null = null;

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

/** Takes a seat the server has handed out, and goes to its room. */
function enterRoom(code: string, token: string): void {
  seats.set(code, token);
  history.pushState(null, "", `/g/${code}`);
  startRemote(code, token);
}

function seek(player: PlayerChoice): void {
  if (search || cancelling) return;
  lobby.showSearching(player);
  const mine = findMatch(player, {
    onSeat: (seat) => {
      if (search !== mine) return;
      search = null;
      enterRoom(seat.code, seat.token);
    },
    onTrouble: (problem) => {
      if (search === mine) lobby.searchTrouble(problem);
    },
  });
  search = mine;
}

/** Whether a cancelled search is still finding out if a stranger was found meanwhile. */
let cancelling = false;
/** What to show once that is known and no stranger was found. The latest request wins. */
let afterCancel: () => void = () => {};

/**
 * Gives up looking for a stranger. Nothing else is shown until the server has answered:
 * if a stranger was found just before, they are already at the table, so the player joins
 * them rather than leave them waiting alone (and must not be free to start another search
 * meanwhile). Otherwise `then` runs. Returns `false`, doing nothing, if there was no search.
 */
function cancelSeek(then: () => void): boolean {
  if (!search && !cancelling) return false;
  afterCancel = then;
  if (cancelling) return true;
  const running = search;
  search = null;
  cancelling = true;
  void settle(running);
  return true;
}

async function settle(running: Search | null): Promise<void> {
  const seat = running ? await running.cancel() : null;
  cancelling = false;
  if (seat) enterRoom(seat.code, seat.token);
  else afterCancel();
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
    enterRoom(body.code, body.token);
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
  onSeek: seek,
  onCancelSeek: () => cancelSeek(() => lobby.showMenu()),
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

// The board is scenery while the start screen is up, set for a game that has yet to start,
// and the playing surface once it is not.
const lobbyEl = el("lobby");
const scenery = new CheckersView(initialBoard());
new MutationObserver(() => {
  stage.setBackdrop(!lobbyEl.hidden);
  if (lobbyEl.hidden) stage.world.remove(scenery.group);
  else stage.world.add(scenery.group);
}).observe(lobbyEl, { attributes: true, attributeFilter: ["hidden"] });

function route(): void {
  // The Back button during a search cancels it, just as Cancel does; where it leads is
  // shown once the cancel is settled.
  if (!cancelSeek(show)) show();
}

/** Shows what the address bar points at: a game this tab has a seat in, or the start screen. */
function show(): void {
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
