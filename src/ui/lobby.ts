import { CODE_LENGTH, normalizeCode } from "../net/protocol.ts";
import { el } from "./dom.ts";

export interface LobbyActions {
  onCreate(name: string): void;
  onJoin(code: string, name: string): void;
  onLocal(): void;
}

export interface LobbyUi {
  /** The start screen, optionally with a code filled in or an error to show. */
  showMenu(options?: { code?: string; error?: string }): void;
  /** The host's screen while the friend has not joined yet. */
  showWaiting(code: string, link: string): void;
  setBusy(busy: boolean): void;
  hide(): void;
}

const NAME_KEY = "name";

function recall(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function remember(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage can be unavailable; the name is only a convenience.
  }
}

export function createLobbyUi(actions: LobbyActions): LobbyUi {
  const root = el("lobby");
  const menu = el<HTMLFormElement>("menu");
  const waiting = el("waiting");
  const name = el<HTMLInputElement>("name");
  const code = el<HTMLInputElement>("code");
  const error = el("lobby-error");
  const copy = el<HTMLButtonElement>("copy-link");
  const buttons = [...menu.querySelectorAll("button")];
  let link = "";

  name.value = recall();
  const playerName = () => {
    remember(name.value.trim());
    return name.value.trim();
  };

  el("create").addEventListener("click", () => actions.onCreate(playerName()));
  el("local").addEventListener("click", () => actions.onLocal());
  menu.addEventListener("submit", (event) => {
    event.preventDefault();
    const wanted = normalizeCode(code.value);
    if (wanted.length !== CODE_LENGTH) {
      error.textContent = `Enter the ${CODE_LENGTH}-letter code your friend gave you`;
      code.focus();
      return;
    }
    actions.onJoin(wanted, playerName());
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = "Link copied";
    } catch {
      copy.textContent = link;
    }
  });

  return {
    showMenu(options = {}) {
      root.hidden = false;
      menu.hidden = false;
      waiting.hidden = true;
      error.textContent = options.error ?? "";
      if (options.code) code.value = options.code;
      (options.code ? name : code.value ? code : name).focus();
    },
    showWaiting(roomCode, inviteLink) {
      link = inviteLink;
      root.hidden = false;
      menu.hidden = true;
      waiting.hidden = false;
      error.textContent = "";
      el("share-code").textContent = roomCode;
      copy.textContent = "Copy invite link";
    },
    setBusy(busy) {
      for (const button of buttons) button.disabled = busy;
    },
    hide() {
      root.hidden = true;
    },
  };
}
