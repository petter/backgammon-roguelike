import { CHARACTER_IDS, CHARACTERS, type CharacterId, characterOf } from "../core/characters.ts";
import { CODE_LENGTH, normalizeCode } from "../net/protocol.ts";
import { characterArt } from "./characterArt.ts";
import { el } from "./dom.ts";

/** What a player chooses about themselves before taking a seat. */
export interface PlayerChoice {
  name: string;
  character: CharacterId;
}

export interface LobbyActions {
  onCreate(player: PlayerChoice): void;
  onJoin(code: string, player: PlayerChoice): void;
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
const CHARACTER_KEY = "character";

function recall(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; remembering the choice is only a convenience.
  }
}

/** Fills the picker: one radio button per character, drawn as its medallion. */
function characterPicker(root: HTMLElement, chosen: CharacterId): () => CharacterId {
  const motto = document.createElement("p");
  motto.className = "quiet motto";
  const options = document.createElement("div");
  options.className = "character-options";
  let current = chosen;
  const show = () => {
    motto.textContent = `${CHARACTERS[current].name}. ${CHARACTERS[current].motto}`;
  };
  for (const id of CHARACTER_IDS) {
    const label = document.createElement("label");
    label.className = "character";
    label.title = CHARACTERS[id].name;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "character";
    input.value = id;
    input.checked = id === chosen;
    input.setAttribute("aria-label", CHARACTERS[id].name);
    input.addEventListener("change", () => {
      current = id;
      show();
    });
    const art = document.createElement("span");
    art.className = "portrait";
    art.innerHTML = characterArt(id);
    label.append(input, art);
    options.append(label);
  }
  show();
  root.append(options, motto);
  return () => current;
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

  name.value = recall(NAME_KEY);
  const character = characterPicker(el("characters"), characterOf(recall(CHARACTER_KEY)));
  const player = (): PlayerChoice => {
    remember(NAME_KEY, name.value.trim());
    remember(CHARACTER_KEY, character());
    return { name: name.value.trim(), character: character() };
  };

  el("create").addEventListener("click", () => actions.onCreate(player()));
  el("local").addEventListener("click", () => actions.onLocal());
  menu.addEventListener("submit", (event) => {
    event.preventDefault();
    const wanted = normalizeCode(code.value);
    if (wanted.length !== CODE_LENGTH) {
      error.textContent = `Enter the ${CODE_LENGTH}-letter code your friend gave you`;
      code.focus();
      return;
    }
    actions.onJoin(wanted, player());
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
