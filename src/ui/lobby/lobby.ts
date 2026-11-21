import "@fontsource/cinzel/700.css";
import "@fontsource/cinzel/900.css";
import { CODE_LENGTH } from "../../net/protocol.ts";
import { el } from "../dom.ts";

import "./lobby.css";
import "./menu.css";
import "./codes.css";
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

export type { PlayerChoice } from "./parts.ts";

export interface LobbyActions {
  onCreate: (player: PlayerChoice) => void;
  onJoin: (code: string, player: PlayerChoice) => void;
  onLocal: () => void;
  /** The host gives up waiting and goes back to the start screen. */
  onCancel: () => void;
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
  setBusy: (busy: boolean) => void;
  hide: () => void;
}

type Step = "host" | "join" | "invited" | "expired" | "full";
type View = "home" | Step;

const PLAY = `<svg class="chevron play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5l8.5 5.5-8.5 5.5z"/></svg>`;
const CHEVRON = `<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>`;
const ICONS = {
  join: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="16" r="6.5"/><path d="M17.5 16H29M24 16v5M28 16v4"/></svg>`,
  host: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24h22M7 24l-2-13 6 5 5-9 5 9 6-5-2 13"/></svg>`,
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
  host: {
    title: "Host a game",
    lede: "Start a table and get a link to send to a friend.",
    go: "Host new game",
    swap: "Join a friend instead",
  },
};

/**
 * The start screen. It first asks what the player wants to do, as a menu of three, and only
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
          <button type="button" class="choice primary-choice" data-go="join">
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
        <p class="lobby-error" role="alert"></p>
      </div>
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
  const buttons = [...home.querySelectorAll("button"), ...step.querySelectorAll("button")];
  let view: View = "home";

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
    view = next;
    root.dataset.view = next;
    home.hidden = next !== "home";
    step.hidden = next === "home";
    waitingPlaque.hidden = true;
    say("");
    code.set(code.value());
    if (next === "home") return;
    const text = STEPS[next];
    title.textContent = text.title;
    lede.textContent = text.lede;
    go.textContent = text.go;
    swap.textContent = text.swap;
    // Choosing Join was a choice: Back leads to hosting, and a link here would outshine Join.
    // From the menu, Back is the way across; a link here would only compete with the button.
    swap.hidden = next === "join" || next === "host";
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
      if (target === "local") actions.onLocal();
      else navigate(target === "join" ? "join" : "host");
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
    const wanted = code.value();
    if (wanted.length !== CODE_LENGTH) {
      say(`Enter all ${CODE_LENGTH} letters of the code your friend sent`, true);
      code.input.focus();
      return;
    }
    actions.onJoin(wanted, you.read());
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
      root.hidden = false;
      root.dataset.view = "waiting";
      home.hidden = true;
      step.hidden = true;
      say("");
      waitingPlaque.hidden = false;
      waiting.show(roomCode, link);
    },
    setBusy(busy) {
      for (const button of buttons) button.disabled = busy;
    },
    hide() {
      root.hidden = true;
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
      show(problem ? view : "home", false);
      if (problem) say(problem);
    }
  }
}
