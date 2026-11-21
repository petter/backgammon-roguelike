import { CHARACTER_IDS, CHARACTERS, type CharacterId, characterOf } from "../../core/characters.ts";
import { CODE_LENGTH, NAME_MAX } from "../../net/protocol.ts";
import { characterArt } from "../characterArt.ts";
import { cleanCode } from "./code.ts";

/** What a player chooses about themselves before taking a seat. */
export interface PlayerChoice {
  name: string;
  character: CharacterId;
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

/** Finds a required element inside a lobby view. */
export function part<T extends HTMLElement = HTMLElement>(
  root: ParentNode,
  selector: string,
  type: new () => T = HTMLElement as unknown as new () => T,
): T {
  const found = root.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing ${selector}`);
  return found;
}

/** Builds fixed markup from our own source, never from user input. */
export function html(markup: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content;
}

/**
 * Who the player is: a name field and a row of character medallions, both remembered
 * between visits.
 */
export function identity(): {
  element: HTMLElement;
  read: () => PlayerChoice;
  focus: () => void;
  /** What the player will be called if they leave the name blank, said in the empty field. */
  fallback: (name: string) => void;
} {
  const element = document.createElement("div");
  element.className = "identity";
  element.append(
    html(`
      <label class="field">
        <span class="field-label">Your name <small>optional</small></span>
        <input id="name" class="name-input" maxlength="${NAME_MAX}" autocomplete="nickname"
          enterkeyhint="go" />
      </label>
      <fieldset class="characters">
        <legend class="field-label">Your emblem <small>just for looks</small></legend>
        <div class="character-options"></div>
      </fieldset>
      <p class="character-motto" aria-live="polite"><b></b> — <i></i></p>
    `),
  );
  const name = part(element, "input", HTMLInputElement);
  const options = part(element, ".character-options");
  const mottoName = part(element, ".character-motto b");
  const motto = part(element, ".character-motto i");
  name.value = recall(NAME_KEY);
  let current = characterOf(recall(CHARACTER_KEY));
  const show = () => {
    mottoName.textContent = CHARACTERS[current].name;
    motto.textContent = CHARACTERS[current].motto;
  };
  for (const id of CHARACTER_IDS) {
    const label = document.createElement("label");
    label.className = "character";
    label.title = CHARACTERS[id].name;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "character";
    input.value = id;
    input.checked = id === current;
    input.setAttribute("aria-label", CHARACTERS[id].name);
    input.addEventListener("change", () => {
      current = id;
      remember(CHARACTER_KEY, id);
      show();
    });
    const art = document.createElement("span");
    art.className = "portrait";
    art.innerHTML = characterArt(id);
    label.append(input, art);
    options.append(label);
  }
  show();
  return {
    element,
    read() {
      const chosen = name.value.trim();
      remember(NAME_KEY, chosen);
      remember(CHARACTER_KEY, current);
      return { name: chosen, character: current };
    },
    focus: () => name.focus(),
    fallback(fallbackName) {
      name.placeholder = `Leave blank to play as ${fallbackName}`;
    },
  };
}

/**
 * A room code typed into one real input, drawn as a row of letter tiles. The input sits
 * invisibly over the tiles, so typing, pasting and autofill all behave as usual.
 */
export function codeEntry(): {
  element: HTMLElement;
  input: HTMLInputElement;
  value: () => string;
  set: (code: string) => void;
  /** Marks the code as the thing that went wrong, until it is changed. */
  flag: () => void;
  /** Focuses the code with all of it selected, so typing starts over. */
  selectAll: () => void;
} {
  const element = document.createElement("div");
  element.className = "code-entry";
  element.append(
    html(`
      <input id="code" class="code-input" autocomplete="off" autocapitalize="characters"
        spellcheck="false" aria-label="Game code" enterkeyhint="go" />
      <div class="code-tiles" aria-hidden="true">${"<span></span>".repeat(CODE_LENGTH)}</div>
    `),
  );
  const input = part(element, "input", HTMLInputElement);
  const tiles = [...element.querySelectorAll<HTMLElement>(".code-tiles span")];
  const paint = () => {
    const cleaned = cleanCode(input.value);
    if (cleaned !== input.value) input.value = cleaned;
    tiles.forEach((tile, index) => {
      tile.textContent = cleaned[index] ?? "";
      tile.classList.toggle("filled", index < cleaned.length);
      tile.classList.toggle("next", index === Math.min(cleaned.length, CODE_LENGTH - 1));
    });
    element.classList.toggle("complete", cleaned.length === CODE_LENGTH);
  };
  const settle = () => element.classList.remove("selected");
  /** The code as it was when it was rejected; it stays flagged until it differs. */
  let rejected: string | null = null;
  const unflag = () => {
    rejected = null;
    element.classList.remove("wrong");
    input.removeAttribute("aria-invalid");
  };
  input.addEventListener("input", (event) => {
    // A letter typed onto a rejected code starts a new one, selected or not, instead of
    // falling off the end of a full row.
    const typed =
      event instanceof InputEvent && event.inputType.startsWith("insert") ? event.data : null;
    if (rejected !== null && typed && cleanCode(input.value) === rejected) input.value = typed;
    settle();
    paint();
    if (rejected !== null && cleanCode(input.value) !== rejected) unflag();
    // With the code complete, a phone's keyboard steps aside to show the rest of the form.
    if (touch.matches && cleanCode(input.value).length === CODE_LENGTH) input.blur();
  });
  input.addEventListener("blur", settle);
  // Coming back to a rejected code, by tap or by Tab, selects all of it to be typed over.
  const reselect = () => {
    if (rejected === null) return;
    setTimeout(() => {
      input.select();
      element.classList.add("selected");
    });
  };
  input.addEventListener("pointerdown", () => {
    settle();
    reselect();
  });
  input.addEventListener("focus", reselect);
  paint();
  return {
    element,
    input,
    value: () => cleanCode(input.value),
    set(code) {
      input.value = code;
      unflag();
      paint();
    },
    flag() {
      rejected = cleanCode(input.value);
      element.classList.add("wrong");
      input.setAttribute("aria-invalid", "true");
    },
    selectAll() {
      input.focus();
      input.select();
      // The input itself is invisible, so the tiles show that typing replaces the code.
      element.classList.add("selected");
    },
  };
}

/** A room code set in ivory letter tiles, like the pieces on the board. */
export function codeTiles(element: HTMLElement, code: string): void {
  element.replaceChildren(
    ...code.split("").map((letter) => {
      const tile = document.createElement("span");
      tile.textContent = letter;
      return tile;
    }),
  );
  const spoken = code.split("").join(" ");
  if (element instanceof HTMLButtonElement)
    element.setAttribute("aria-label", `Copy game code ${spoken}`);
  else {
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", `Game code ${spoken}`);
  }
}

/** Phones and tablets: share sheets and on-screen keyboards. */
export const touch = matchMedia("(pointer: coarse)");

/** A phone's share sheet, where there is one; with a mouse, copying suits better. */
const share = () => touch.matches && typeof navigator.share === "function";
const label = () => (share() ? "Share invite link" : "Copy invite link");

/**
 * The host's waiting room: the code, large, a way to send the invite link, and a way out.
 * With a mouse the link is copied, ready to paste into a chat; on a phone it is shared.
 */
export function waitingRoom(onCancel: () => void): {
  element: HTMLElement;
  show: (code: string, link: string) => void;
} {
  const element = document.createElement("section");
  element.className = "waiting";
  element.setAttribute("aria-labelledby", "waiting-title");
  element.append(
    html(`
      <h2 id="waiting-title" class="lobby-heading">Your table is set</h2>
      <p class="lede">Send your friend the invite link, or read them the code.</p>
      <button type="button" class="share-code ivory-tiles" title="Copy the code"></button>
      <p class="tile-caption" aria-live="polite"></p>
      <button type="button" class="primary send-link"></button>
      <input class="invite-link" readonly aria-label="Invite link" />
      <p class="waiting-status" role="status"><span class="pulse-dot"></span>Waiting for your friend to join</p>
      <button type="button" class="link cancel">Cancel</button>
    `),
  );
  const codeBox = part(element, ".share-code", HTMLButtonElement);
  let code = "";
  const send = part(element, ".send-link", HTMLButtonElement);
  const linkField = part(element, ".invite-link", HTMLInputElement);
  const caption = part(element, ".tile-caption");
  const captionText = `${touch.matches ? "Tap" : "Click"} the letters to copy the code`;
  caption.textContent = captionText;
  let captionRestore = 0;
  let restore = 0;
  const copied = (text: string) => {
    send.textContent = text;
    clearTimeout(restore);
    restore = window.setTimeout(() => (send.textContent = label()), 2000);
  };
  let link = "";
  const sendLink = async () => {
    if (share()) {
      try {
        await navigator.share({ title: "Backgammon Roguelike", url: link });
        return;
      } catch (error) {
        // Closing the share sheet is a choice, not a failure; anything else falls back to copying.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      copied("Link copied ✓");
    } catch {
      // No clipboard access: select the link so it can be copied by hand.
      linkField.focus();
      linkField.select();
      copied("Copy the link below");
    }
  };
  send.addEventListener("click", () => void sendLink());
  // The code itself copies too, for reading out or typing into a message by hand.
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    caption.textContent = "Code copied ✓";
    clearTimeout(captionRestore);
    captionRestore = window.setTimeout(() => (caption.textContent = captionText), 2000);
  };
  codeBox.addEventListener("click", () => void copyCode());

  linkField.addEventListener("focus", () => linkField.select());
  linkField.addEventListener("copy", (event) => {
    event.clipboardData?.setData("text/plain", link);
    event.preventDefault();
  });
  part(element, ".cancel").addEventListener("click", onCancel);
  return {
    element,
    show(roomCode, inviteLink) {
      code = roomCode;
      link = inviteLink;
      // Shown without the scheme, to read as an address; copying still takes the full link.
      linkField.value = inviteLink.replace(/^https?:\/\//, "");
      codeTiles(codeBox, roomCode);
      clearTimeout(restore);
      send.textContent = label();
    },
  };
}
