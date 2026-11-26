import "./style.css";
import {
  type GameMode,
  type JoinVia,
  secondsSince,
  startAnalytics,
  track,
} from "./app/analytics.ts";
import { gameReporter } from "./app/gameAnalytics.ts";
import { runGame } from "./app/gameScreen.ts";
import { seedFromQuery } from "./app/seed.ts";
import { tableGeometry } from "./app/tableGeometry.ts";
import { unlockAudio } from "./audio/engine.ts";
import { initialBoard } from "./core/board.ts";
import { createLocalSession } from "./net/localSession.ts";
import { findMatch, type Search, settleTicket } from "./net/matchmaking.ts";
import { trackOnline } from "./net/online.ts";
import { codeFromPath, type RoomStatus, type SeatGrant } from "./net/protocol.ts";
import { createRemoteSession } from "./net/remoteSession.ts";
import { seatMemory } from "./net/seatStorage.ts";
import { ticketMemory } from "./net/unsettled.ts";
import { createBoard } from "./render/board.ts";
import { CheckersView } from "./render/checkers.ts";
import { createStage } from "./render/stage.ts";
import { createChat } from "./ui/chat.ts";
import { createCoach } from "./ui/coach.ts";
import { el } from "./ui/dom.ts";
import { createHud } from "./ui/hud.ts";
import { createLobbyUi, type PlayerChoice } from "./ui/lobby/lobby.ts";
import { createRevealView } from "./ui/reveal.ts";
import { createSoundToggle } from "./ui/soundToggle.ts";
import { createTable } from "./ui/table.ts";

void startAnalytics();
unlockAudio();

const stageEl = el("stage");
const stage = createStage(stageEl);
const board = createBoard();
stage.world.add(board.group);
const hud = createHud();
createSoundToggle(el("sound", HTMLButtonElement));
const coach = createCoach();
const table = createTable(() => tableGeometry(stage));
const deps = { stageEl, stage, board, hud, coach, reveal: createRevealView(), table };
const chat = createChat();

let stopGame: (() => void) | null = null;
/** The search for a stranger, while one is running. */
let search: Search | null = null;
/** Keeps this tab on the count of who is online, and says whether it is searching. */
const online = trackOnline((counts) => lobby.onlineCounts(counts));

function setSearch(next: Search | null): void {
  search = next;
  // Counts from before the search began would leave this player out of those searching.
  if (next) lobby.onlineCounts(null);
  online.setSearching(next !== null);
}

/** Seat tokens live in sessionStorage: per tab, so two tabs can be two players. */
const seats = seatMemory();
/** How this tab came to each room, for analytics. Forgotten on reload: then just "online". */
const modes = new Map<string, GameMode>();

function leaveGame(): void {
  chat.stop();
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
  const report = gameReporter(modes.get(code) ?? "online");
  stopGame = runGame(deps, {
    local: false,
    connect: (handlers) => {
      // Chat lives beside the game, not in it: hot-seat players share a screen.
      const session = createRemoteSession(code, token, {
        ...handlers,
        onUpdate: (update) => {
          chat.setLobby(update.lobby);
          report(update);
          handlers.onUpdate(update);
        },
        onChat: chat.receive,
      });
      chat.start((text) => {
        const sent = session.say(text);
        if (sent) track("chat_sent", {});
        return sent;
      });
      return session;
    },
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
  const report = gameReporter("local");
  stopGame = runGame(deps, {
    local: true,
    connect: (handlers) =>
      createLocalSession(
        {
          ...handlers,
          onUpdate: (update) => {
            report(update);
            handlers.onUpdate(update);
          },
        },
        seed,
      ),
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
function enterRoom(code: string, token: string, mode: GameMode): void {
  seats.set(code, token);
  modes.set(code, mode);
  history.pushState(null, "", `/g/${code}`);
  startRemote(code, token);
}

/**
 * A ticket given up without an answer yet: its cancel is on its way, went unanswered, or
 * was a beacon as the page went away. The server may have matched it all the same, with a
 * stranger now waiting at that table, so it is settled before any new search.
 */
const unsettledTickets = ticketMemory();
/** The same, for when storage is unavailable: then it lasts until the page is reloaded. */
let unsettledHere: string | null = null;
const unsettled = {
  get: () => unsettledTickets.get() ?? unsettledHere,
  set(ticket: string) {
    unsettledHere = ticket;
    unsettledTickets.set(ticket);
  },
  clear(ticket?: string) {
    if (ticket === undefined || unsettledHere === ticket) unsettledHere = null;
    unsettledTickets.clear(ticket);
  },
};
/** Whether that is being done right now. */
let settling = false;
/** When the running search began. */
let searchStart = 0;

function seek(player: PlayerChoice): void {
  if (search || cancelling || settling) return;
  const leftover = unsettled.get();
  if (leftover) {
    void settleThenSeek(leftover, player);
    return;
  }
  lobby.showSearching(player);
  track("search_started", { character: player.character });
  searchStart = Date.now();
  const mine = findMatch(player, {
    onSeat: (seat) => {
      if (search !== mine) return;
      setSearch(null);
      // Only clear this search's ticket so any distinct legacy ticket still settles if needed.
      unsettled.clear(mine.ticket());
      track("match_found", { waited_s: secondsSince(searchStart) });
      enterRoom(seat.code, seat.token, "matched");
    },
    onTrouble: (problem) => {
      if (search === mine) lobby.searchTrouble(problem);
    },
    onLeave: (ticket) => unsettled.set(ticket),
    onSettled: (ticket) => unsettled.clear(ticket),
  });
  setSearch(mine);
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
  setSearch(null);
  cancelling = true;
  // Kept until the server answers, so a reload meanwhile still settles it first.
  if (running) unsettled.set(running.ticket());
  lobby.searchCancelling();
  void settle(running);
  return true;
}

async function settle(running: Search | null): Promise<void> {
  const outcome = running ? await running.cancel() : null;
  cancelling = false;
  if (outcome?.settled && running) unsettled.clear(running.ticket());
  // Found just before the cancel: the player is seated all the same.
  const waited_s = secondsSince(searchStart);
  if (outcome?.seat) {
    track("match_found", { waited_s });
    enterRoom(outcome.seat.code, outcome.seat.token, "matched");
  } else {
    if (running) track("search_cancelled", { waited_s });
    afterCancel();
  }
}

/** Settles the ticket left over from an unanswered cancel, then searches if nobody waits. */
async function settleThenSeek(ticket: string, player: PlayerChoice): Promise<void> {
  settling = true;
  lobby.setBusy(true);
  const outcome = await settleTicket(ticket);
  settling = false;
  lobby.setBusy(false);
  if (!outcome.settled) {
    lobby.showMenu({ error: "Could not reach the game server" });
    return;
  }
  unsettled.clear(ticket);
  // Matched after all: that stranger has been waiting, so the player joins them.
  if (outcome.seat) enterRoom(outcome.seat.code, outcome.seat.token, "matched");
  else seek(player);
}

/** Refusals that are about the code itself: no game has it, or its game is full. */
const CODE_ERRORS: Partial<Record<number, "missing" | "full">> = { 404: "missing", 409: "full" };

/** Asks the server for a seat, then enters the room. `via` is how a guest got the code. */
async function takeSeat(path: string, player: PlayerChoice, via?: JoinVia): Promise<void> {
  const failed = (reason: "missing" | "full" | "unreachable") => {
    if (via) track("room_join_failed", { via, reason });
  };
  lobby.setBusy(true);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...player, presence: true }),
    });
    const body = (await response.json()) as Partial<SeatGrant> & { error?: string };
    if (!response.ok || !body.code || !body.token) {
      // No such game, or it is full: the code is what to look at again.
      const codeError = CODE_ERRORS[response.status];
      failed(codeError ?? "unreachable");
      lobby.showMenu({ error: body.error ?? "Could not reach the game server", codeError });
      return;
    }
    if (via) track("room_joined", { via, character: player.character });
    else track("room_created", { character: player.character });
    enterRoom(body.code, body.token, "friend");
  } catch {
    failed("unreachable");
    lobby.showMenu({ error: "Could not reach the game server" });
  } finally {
    lobby.setBusy(false);
  }
}

const lobby = createLobbyUi({
  onCreate: (player) => void takeSeat("/api/rooms", player),
  onJoin: (code, player, via) => void takeSeat(`/api/rooms/${code}/join`, player, via),
  onLocal: startLocal,
  onCancel: toMenu,
  onSeek: seek,
  onCancelSeek: () => cancelSeek(() => lobby.showMenu()),
});

/** Looks up an invite's room as the guest arrives, so a dead link says so straight away. */
async function checkInvite(code: string): Promise<void> {
  try {
    const response = await fetch(`/api/rooms/${code}`);
    if (response.status === 404) {
      track("invite_dead", { why: "missing" });
      return lobby.inviteClosed("missing");
    }
    if (!response.ok) return;
    const { status } = (await response.json()) as { status?: RoomStatus };
    if (status === "full") {
      track("invite_dead", { why: "full" });
      lobby.inviteClosed("full");
    }
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
    if (code) {
      track("invite_opened", {});
      void checkInvite(code);
    }
  }
}

window.addEventListener("popstate", route);
route();
