import "@fontsource/cinzel/700.css";
import "@fontsource/cinzel/900.css";
import { CODE_LENGTH } from "../../net/protocol.ts";
import { el } from "../dom.ts";

import "./lobby.css";
import "./menu.css";
import { codeEntry, html, identity, part, type PlayerChoice, waitingRoom } from "./parts.ts";

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
  /** The error is about the code itself, such as no game having it. */
  codeError?: boolean;
}

export interface LobbyUi {
  showMenu: (options?: MenuOptions) => void;
  /** The host's screen while the friend has not joined yet. */
  showWaiting: (code: string, link: string) => void;
  setBusy: (busy: boolean) => void;
  hide: () => void;
}

type View = "home" | "host" | "join";

const CHEVRON = `<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>`;
const ICONS = {
  join: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="16" r="6.5"/><path d="M17.5 16H29M24 16v5M28 16v4"/></svg>`,
  host: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24h22M7 24l-2-13 6 5 5-9 5 9 6-5-2 13"/></svg>`,
  local: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="9.5" cy="16" r="6.5" class="light"/><circle cx="9.5" cy="16" r="3" class="groove"/><circle cx="22.5" cy="16" r="6.5"/><circle cx="22.5" cy="16" r="3" class="groove"/></svg>`,
};

/** Text for each form: its heading, a line of what happens, its button, and the way across. */
const STEPS = {
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
    swap: "Host your own game instead",
  },
  host: {
    title: "Host a game",
    lede: "Start a table and get a link to send to a friend.",
    go: "Host new game",
    swap: "Have a code? Join a friend",
  },
};

const EXPIRED =
  "This invite link no longer works. Check the code with your friend, or host your own game.";

/** Phones and tablets: focusing a field would throw up the keyboard over the button. */
const touch = matchMedia("(pointer: coarse)");

/**
 * The start screen. It first asks what the player wants to do, as a menu of three, and only
 * then shows the short form for that choice, so a guest never stands next to a host button.
 * An invite link skips the menu and seats the guest straight away.
 */
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
            <span class="choice-text"><b>Pass and play</b><i>Both sides on this device</i></span>
          </button>
        </nav>
        <form class="plaque step" novalidate hidden>
          <button type="button" class="link back">‹ Back</button>
          <header>
            <h2 class="lobby-heading step-title" id="step-title"></h2>
            <p class="lede step-lede"></p>
          </header>
          <p class="invite-code"><span class="field-label">Game code</span><b></b></p>
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
  const go = part(root, ".go", HTMLButtonElement);
  const swap = part(root, ".swap");
  const codeSlot = part(root, ".code-slot");
  const you = identity();
  part(root, ".you-slot").append(you.element);
  const code = codeEntry();
  codeSlot.append(code.element);
  const error = part(root, ".lobby-error");
  const waitingPlaque = part(root, ".waiting-plaque");
  const waiting = waitingRoom(actions.onCancel);
  waitingPlaque.append(waiting.element);
  const buttons = [...home.querySelectorAll("button"), ...step.querySelectorAll("button")];
  step.setAttribute("aria-labelledby", "step-title");
  let view: View = "home";
  let invited = false;

  /** Shows the message next to what it is about: the code, the form, or the menu. */
  const say = (message: string, aboutCode = false) => {
    error.textContent = message;
    if (aboutCode) {
      code.flag();
      codeSlot.after(error);
    } else if (view === "home") home.after(error);
    else go.before(error);
  };

  const show = (next: View, focus = true) => {
    view = next;
    if (next !== "join") invited = false;
    root.dataset.view = next;
    home.hidden = next !== "home";
    step.hidden = next === "home";
    waitingPlaque.hidden = true;
    say("");
    code.set(code.value());
    if (next === "home") return;
    const text = STEPS[next === "join" && invited ? "invited" : next];
    title.textContent = text.title;
    lede.textContent = text.lede;
    go.textContent = text.go;
    swap.textContent = text.swap;
    back.hidden = invited;
    inviteCode.hidden = !invited;
    part(inviteCode, "b").textContent = invited ? code.value() : "";
    codeSlot.hidden = next !== "join" || invited;
    if (!focus) return;
    if (next === "join" && !invited && code.value().length < CODE_LENGTH) code.input.focus();
    else if (!touch.matches) you.focus();
  };

  for (const choice of home.querySelectorAll<HTMLButtonElement>("[data-go]")) {
    choice.addEventListener("click", () => {
      const target = choice.dataset.go;
      if (target === "local") actions.onLocal();
      else show(target === "join" ? "join" : "host");
    });
  }
  back.addEventListener("click", () => {
    show("home");
    part(home, "[data-go]").focus({ focusVisible: false });
  });
  swap.addEventListener("click", () => show(view === "join" ? "host" : "join"));
  step.addEventListener("submit", (event) => {
    event.preventDefault();
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
    showMenu({ code: invite, error: problem, codeError = false } = {}) {
      root.hidden = false;
      let message = problem;
      if (invite) {
        invited = true;
        code.set(invite);
        show("join");
      } else if (codeError) {
        // The code was wrong or the game is gone: let them check it or type another.
        if (invited && message) message = EXPIRED;
        invited = false;
        show("join", false);
        code.input.focus();
        code.input.select();
      } else {
        show(message ? view : "home", false);
      }
      if (message) say(message, codeError);
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
}
