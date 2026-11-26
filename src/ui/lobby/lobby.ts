import "@fontsource/cinzel/700.css";
import "@fontsource/cinzel/900.css";
import { type Events, type JoinVia, track } from "../../app/analytics.ts";
import { CODE_LENGTH, type OnlineCounts } from "../../net/protocol.ts";
import { el } from "../dom.ts";

import "./lobby.css";
import "./menu.css";
import "./codes.css";
import "./search.css";
import {
  codeEntry,
  codeTiles,
  html,
  identity,
  part,
  type PlayerChoice,
  touch,
  waitingRoom,
} from "./parts.ts";
import { rulesPage } from "./rules.ts";
import { searchRoom } from "./search.ts";

export type { PlayerChoice } from "./parts.ts";

export interface LobbyActions {
  onCreate: (player: PlayerChoice) => void;
  /** `via` says whether the guest typed the code or came by invite link. */
  onJoin: (code: string, player: PlayerChoice, via: JoinVia) => void;
  onLocal: () => void;
  /** The host gives up waiting and goes back to the start screen. */
  onCancel: () => void;
  /** Starts looking for a stranger to play. */
  onSeek: (player: PlayerChoice) => void;
  /** Gives up looking for a stranger. */
  onCancelSeek: () => void;
}

export interface MenuOptions {
  /** A code from an invite link: the player arrives as an invited guest. */
  code?: string;
  error?: string;
  /** The error is about the code itself: no game has it, or its game is full. */
  codeError?: "missing" | "full";
}

export interface LobbyUi {
  showMenu: (options?: MenuOptions) => void;
  /** The host's screen while the friend has not joined yet. */
  showWaiting: (code: string, link: string) => void;
  /** The invite being shown leads nowhere: its game is gone or already has two players. */
  inviteClosed: (why: "missing" | "full") => void;
  /** While a stranger is being found. */
  showSearching: (player: PlayerChoice) => void;
  /** Says the server cannot be reached while searching, or `null` once it can again. */
  searchTrouble: (problem: string | null) => void;
  /** Shows how many are online and searching, or nothing while that is not known. */
  onlineCounts: (counts: OnlineCounts | null) => void;
  /** Says the search is being called off, while the server answers. */
  searchCancelling: () => void;
  setBusy: (busy: boolean) => void;
  hide: () => void;
}

type Step = "host" | "join" | "seek" | "invited" | "expired" | "full";
type MenuChoice = Events["menu_choice"]["choice"];

const MENU_CHOICES: readonly string[] = [
  "seek",
  "join",
  "host",
  "local",
  "rules",
] satisfies MenuChoice[];
const isMenuChoice = (go: string | undefined): go is MenuChoice =>
  go !== undefined && MENU_CHOICES.includes(go);
type View = "home" | "rules" | Step;

const PLAY = `<svg class="chevron play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5l8.5 5.5-8.5 5.5z"/></svg>`;
const CHEVRON = `<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>`;
const ICONS = {
  join: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="16" r="6.5"/><path d="M17.5 16H29M24 16v5M28 16v4"/></svg>`,
  host: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24h22M7 24l-2-13 6 5 5-9 5 9 6-5-2 13"/></svg>`,
  seek: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11"/><ellipse cx="16" cy="16" rx="4.6" ry="11"/><path d="M5 16h22M7.5 10.5h17M7.5 21.5h17"/></svg>`,
  rules: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.5c3-1.4 6-1.4 9 .8v13c-3-2.2-6-2.2-9-.8zM21 5.5c-3-1.4-6-1.4-9 .8v13c3-2.2 6-2.2 9-.8z"/></svg>`,
  github: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  local: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="12" cy="12" r="7.5" class="dark"/><circle cx="12" cy="12" r="3.4" class="groove"/><circle cx="20" cy="20" r="7.5" class="light"/><circle cx="20" cy="20" r="3.4" class="groove"/></svg>`,
};

/** Text for each form: its heading, a line of what happens, its button, and the way across. */
const STEPS: Record<Step, { title: string; lede: string; go: string; swap: string }> = {
  join: {
    title: "Join a friend",
    lede: "Got a code from a friend? Enter it here.",
    go: "Join game",
    swap: "Host a game instead",
  },
  invited: {
    title: "You're invited",
    lede: "A friend has set a table for you. Choose how you'll appear, then take your seat.",
    go: "Take your seat",
    swap: "Host a game instead",
  },
  expired: {
    title: "Invite expired",
    lede: "The game behind this link is over. Ask your friend for a new link, or enter another code.",
    go: "Enter another code",
    swap: "Host a game instead",
  },
  full: {
    title: "Table is full",
    lede: "Two players are already seated at this table. Ask your friend for a new link, or enter another code.",
    go: "Enter another code",
    swap: "Host a game instead",
  },
  seek: {
    title: "Find an opponent",
    lede: "No one to play with? You'll be seated with the next player who is looking.",
    go: "Find opponent",
    swap: "Host a game instead",
  },
  host: {
    title: "Host a game",
    lede: "Start a table and get a link to send to a friend.",
    go: "Host new game",
    swap: "Join a friend instead",
  },
};

/**
 * The start screen. It first asks what the player wants to do, as a short menu, and only
 * then shows the short form for that choice, so a guest never stands next to a host button.
 * An invite link skips the menu and seats the guest straight away.
 */
const calm = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Applies a change to the screen. Each view is centred on its own, so where the browser
 * can, the title and plaque glide to their new places instead of jumping.
 */
function glide(change: () => void): void {
  if (!("startViewTransition" in document) || calm.matches) change();
  else document.startViewTransition(change);
}

export function createLobbyUi(actions: LobbyActions): LobbyUi {
  const root = el("lobby");
  root.replaceChildren(
    html(`
      <div class="lobby-shell">
        <h1 class="lobby-title"><span>Backgammon</span><span>Roguelike</span><small>Dice, cards and a friend across the board</small></h1>
        <nav class="home" aria-label="How do you want to play?">
          <button type="button" class="choice primary-choice" data-go="seek">
            <span class="choice-icon">${ICONS.seek}</span>
            <span class="choice-text"><b>Play online</b><i>Get matched with a stranger</i></span>${CHEVRON}
          </button>
          <button type="button" class="choice" data-go="join">
            <span class="choice-icon">${ICONS.join}</span>
            <span class="choice-text"><b>Join a friend</b><i>I have a game code</i></span>${CHEVRON}
          </button>
          <button type="button" class="choice" data-go="host">
            <span class="choice-icon">${ICONS.host}</span>
            <span class="choice-text"><b>Host a game</b><i>Invite a friend to play</i></span>${CHEVRON}
          </button>
          <button type="button" class="choice quiet-choice" data-go="local">
            <span class="choice-icon">${ICONS.local}</span>
            <span class="choice-text"><b>Pass and play</b><i>Both sides on this device</i></span>${PLAY}
          </button>
          <button type="button" class="link rules-link" data-go="rules">${ICONS.rules}How to play</button>
        </nav>
        <form class="plaque step" novalidate hidden aria-labelledby="step-title">
          <button type="button" class="link back">‹ Back</button>
          <header>
            <h2 class="lobby-heading step-title" id="step-title"></h2>
            <p class="lede step-lede"></p>
          </header>
          <div class="invite-code"><span class="field-label">Game code</span><div class="ivory-tiles small"></div></div>
          <div class="code-slot"><label class="field-label" for="code">Game code</label></div>
          <div class="you-slot"></div>
          <button type="submit" class="primary go"></button>
          <button type="button" class="link swap"></button>
        </form>
        <div class="plaque waiting-plaque" hidden></div>
        <div class="plaque searching-plaque" hidden></div>
        <p class="lobby-error" role="alert"></p>
      </div>
      <footer class="lobby-footer">
        <a href="https://github.com/petter/backgammon-roguelike" target="_blank" rel="noopener noreferrer">${ICONS.github}Source on GitHub</a>
        <a href="https://x.com/pettersmoen" target="_blank" rel="noopener noreferrer">${ICONS.x}@pettersmoen</a>
      </footer>
    `),
  );
  const home = part(root, ".home");
  const step = part(root, ".step", HTMLFormElement);
  const back = part(root, ".back");
  const title = part(root, ".step-title");
  const lede = part(root, ".step-lede");
  const inviteCode = part(root, ".invite-code");
  const inviteTiles = part(inviteCode, ".ivory-tiles");
  const go = part(root, ".go", HTMLButtonElement);
  const swap = part(root, ".swap");
  const codeSlot = part(root, ".code-slot");
  const you = identity();
  const youSlot = part(root, ".you-slot");
  youSlot.append(you.element);
  const code = codeEntry();
  codeSlot.append(code.element);
  const error = part(root, ".lobby-error");
  const waitingPlaque = part(root, ".waiting-plaque");
  const waiting = waitingRoom(actions.onCancel);
  waitingPlaque.append(waiting.element);
  const rulesLink = part(root, ".rules-link");
  const rules = rulesPage(() => navigate("home", () => rulesLink.focus({ focusVisible: false })));
  rules.element.hidden = true;
  error.before(rules.element);
  const searchingPlaque = part(root, ".searching-plaque");
  const searching = searchRoom(actions.onCancelSeek);
  searchingPlaque.append(searching.element);
  const buttons = [...home.querySelectorAll("button"), ...step.querySelectorAll("button")];
  let view: View = "home";
  /** Bumped by every change of view, so a view transition that has been overtaken does nothing. */
  let shown = 0;

  /** Shows the message next to what it is about: the code, the form, or the menu. */
  const say = (message: string, aboutCode = false) => {
    error.textContent = message;
    if (aboutCode) {
      code.flag();
      // The same code would only fail again: Join waits until it is changed.
      go.setAttribute("aria-disabled", "true");
      codeSlot.after(error);
    } else if (view === "home") home.after(error);
    else go.before(error);
  };

  const show = (next: View, focus = true) => {
    shown++;
    view = next;
    root.dataset.view = next;
    home.hidden = next !== "home";
    rules.element.hidden = next !== "rules";
    step.hidden = next === "home" || next === "rules";
    waitingPlaque.hidden = true;
    searchingPlaque.hidden = true;
    searching.stop();
    say("");
    code.set(code.value());
    if (next === "home") return;
    if (next === "rules") {
      root.scrollTop = 0;
      rules.reset();
      if (focus) rules.back.focus({ focusVisible: false });
      return;
    }
    const text = STEPS[next];
    title.textContent = text.title;
    lede.textContent = text.lede;
    go.textContent = text.go;
    swap.textContent = text.swap;
    // Choosing Join was a choice: Back leads to hosting, and a link here would outshine Join.
    // From the menu, Back is the way across; a link here would only compete with the button.
    swap.hidden = next === "join" || next === "host" || next === "seek";
    go.removeAttribute("aria-disabled");
    // An invited guest came by link: there is no menu behind them to go back to.
    const dead = next === "expired" || next === "full";
    const byLink = next === "invited" || dead;
    // A guest who came by link has no menu behind them, until the link turns out dead.
    back.hidden = next === "invited";
    back.textContent = dead ? "‹ Menu" : "‹ Back";
    inviteCode.hidden = !byLink;
    if (byLink) codeTiles(inviteTiles, code.value());
    codeSlot.hidden = next !== "join";
    youSlot.hidden = dead;
    // Blank names fall back to these on the server, so that is what the field promises.
    you.fallback(next === "host" ? "Host" : "Guest");
    if (!focus) return;
    // The code comes first, so a phone may raise its keyboard for it; never for the name,
    // where the keyboard would cover the button.
    if (next === "join" && code.value().length < CODE_LENGTH) code.input.focus();
    else if (!touch.matches) you.focus();
  };

  /** Moves to another view at the player's request. */
  const navigate = (next: View, after?: () => void) =>
    glide(() => {
      show(next);
      after?.();
    });

  for (const choice of home.querySelectorAll<HTMLButtonElement>("[data-go]")) {
    choice.addEventListener("click", () => {
      const target = choice.dataset.go;
      if (isMenuChoice(target)) track("menu_choice", { choice: target });
      if (target === "local") actions.onLocal();
      else if (target === "rules") navigate("rules");
      else if (target === "join" || target === "host" || target === "seek") navigate(target);
    });
  }
  back.addEventListener("click", () =>
    navigate("home", () => part(home, "[data-go]").focus({ focusVisible: false })),
  );
  swap.addEventListener("click", () => navigate(view === "host" ? "join" : "host"));
  // Once the rejected code is changed, Join is live again and the old complaint goes.
  code.input.addEventListener("input", () => {
    if (go.getAttribute("aria-disabled") !== "true" || code.element.classList.contains("wrong"))
      return;
    go.removeAttribute("aria-disabled");
    say("");
  });
  step.addEventListener("submit", (event) => {
    event.preventDefault();
    if (go.getAttribute("aria-disabled") === "true") {
      code.selectAll();
      return;
    }
    if (view === "expired" || view === "full") {
      code.set("");
      navigate("join");
      return;
    }
    if (view === "host") {
      actions.onCreate(you.read());
      return;
    }
    if (view === "seek") {
      actions.onSeek(you.read());
      return;
    }
    const wanted = code.value();
    if (wanted.length !== CODE_LENGTH) {
      say(`Enter all ${CODE_LENGTH} letters of the code your friend sent`, true);
      code.input.focus();
      return;
    }
    actions.onJoin(wanted, you.read(), view === "invited" ? "invite_link" : "code");
  });

  return {
    showMenu(options = {}) {
      // On screen already, a change such as an error appearing glides rather than jumps.
      if (root.hidden) menu(options);
      else glide(() => menu(options));
    },
    inviteClosed(why) {
      // Only while the guest is still looking at that invite.
      if (view === "invited") glide(() => show(why === "full" ? "full" : "expired", false));
    },
    showWaiting(roomCode, link) {
      shown++;
      root.hidden = false;
      root.dataset.view = "waiting";
      home.hidden = true;
      step.hidden = true;
      rules.element.hidden = true;
      searchingPlaque.hidden = true;
      searching.stop();
      say("");
      waitingPlaque.hidden = false;
      waiting.show(roomCode, link);
    },
    showSearching(player) {
      const mine = ++shown;
      glide(() => {
        // A match can arrive, and the lobby be hidden, before the transition gets here.
        if (mine !== shown) return;
        root.hidden = false;
        root.dataset.view = "searching";
        home.hidden = true;
        step.hidden = true;
        rules.element.hidden = true;
        waitingPlaque.hidden = true;
        say("");
        searchingPlaque.hidden = false;
        searching.show(player);
        part(searching.element, ".cancel").focus({ focusVisible: false });
      });
    },
    searchTrouble: (problem) => searching.trouble(problem),
    onlineCounts: (counts) => searching.counts(counts),
    searchCancelling: () => searching.cancelling(),
    setBusy(busy) {
      for (const button of buttons) button.disabled = busy;
    },
    hide() {
      shown++;
      root.hidden = true;
      searching.stop();
    },
  };

  function menu({ code: invite, error: problem, codeError }: MenuOptions): void {
    root.hidden = false;
    if (invite) {
      code.set(invite);
      show("invited");
    } else if (codeError && view === "invited") {
      // The link's game is gone or taken. Stay with the invite and offer the ways on.
      show(codeError === "full" ? "full" : "expired", false);
    } else if (codeError) {
      // The code was wrong or the game is full: let them check it or type another.
      show("join", false);
      if (problem) say(`${problem}. Check the code with your friend.`, true);
      if (!touch.matches) code.selectAll();
    } else {
      // The rules page has no place for an error: it is said on the menu instead.
      show(problem && view !== "rules" ? view : "home", false);
      if (problem) say(problem);
    }
  }
}
