import "./chat.css";
import { mergeChat } from "../app/chatLog.ts";
import { sfx } from "../audio/sfx.ts";
import type { Player } from "../core/board.ts";
import { CHAT_MAX, type ChatMessage, cleanChat, type LobbyView } from "../net/protocol.ts";
import { el } from "./dom.ts";

/** How long a line from the opponent is previewed while the chat is shut. */
const PREVIEW_MS = 6000;
/** How long a sent line waits for its echo before pressing Send again sends it again. */
const RESEND_MS = 1000;

const BUBBLE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z"/></svg>`;

export interface ChatView {
  /** Opens chat for a game with someone else; `say` sends a line to them. */
  start: (say: (text: string) => boolean) => void;
  /** Who is who: the names, and which seat is this player's. */
  setLobby: (lobby: LobbyView) => void;
  /** Lines from the server, in any order and possibly again. */
  receive: (messages: ChatMessage[]) => void;
  /** Ends chat for this game: hides it all and forgets what was said. */
  stop: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * The chat between the two seats of an online game: a button in the HUD with an unread
 * count, a panel with the log and a line to type in, and a short preview of each line the
 * opponent says while the panel is shut. Enter opens it from anywhere; Escape shuts it.
 */
export function createChat(): ChatView {
  const toggle = el("chat-toggle", HTMLButtonElement);
  const panel = el("chat-panel");
  const close = el("chat-close", HTMLButtonElement);
  const list = el("chat-log");
  const empty = el("chat-empty");
  const form = el("chat-form", HTMLFormElement);
  const input = el("chat-input", HTMLInputElement);
  const preview = el("chat-preview", HTMLButtonElement);

  let say: ((text: string) => boolean) | null = null;
  let lobby: LobbyView | null = null;
  let lines: ChatMessage[] = [];
  /** The first lines of a game are its history: shown, but not announced. */
  let primed = false;
  let unread = 0;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The line last sent, kept in the field until the server echoes it back as kept. One the
   * server turned down (too fast, or not stored) is still there to send again.
   */
  let sending: string | null = null;
  let sentAt = 0;

  const isOpen = () => !panel.hidden;
  const nameOf = (player: Player) =>
    lobby?.players[player]?.name ?? (player === "white" ? "White" : "Black");

  const renderToggle = () => {
    toggle.innerHTML = `${BUBBLE}<span>Chat</span>`;
    if (unread > 0) {
      const badge = document.createElement("span");
      badge.className = "chat-badge";
      badge.textContent = unread > 9 ? "9+" : String(unread);
      toggle.append(badge);
    }
    const key = document.createElement("kbd");
    key.textContent = "Enter";
    toggle.append(key);
    toggle.setAttribute("aria-label", unread > 0 ? `Chat, ${unread} unread` : "Chat");
    toggle.setAttribute("aria-expanded", String(isOpen()));
  };

  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 24;

  const renderLog = (stick: boolean) => {
    list.replaceChildren(
      ...lines.map((line, index) => {
        const item = document.createElement("li");
        const mine = line.from === lobby?.you;
        item.className = mine ? "mine" : "theirs";
        item.title = new Date(line.at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        // A run of lines from one player is named once.
        if (lines[index - 1]?.from !== line.from) {
          const who = document.createElement("span");
          who.className = "who";
          who.textContent = mine ? "You" : nameOf(line.from);
          item.append(who);
        }
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = line.text;
        item.append(text);
        return item;
      }),
    );
    empty.hidden = lines.length > 0;
    if (stick) list.scrollTop = list.scrollHeight;
  };

  const hidePreview = () => {
    clearTimeout(previewTimer);
    preview.hidden = true;
  };

  const showPreview = (line: ChatMessage) => {
    preview.replaceChildren();
    const who = document.createElement("strong");
    who.textContent = nameOf(line.from);
    const text = document.createElement("span");
    text.textContent = line.text;
    preview.append(who, text);
    preview.setAttribute("aria-label", `${nameOf(line.from)} says: ${line.text}. Open chat`);
    preview.hidden = false;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(hidePreview, PREVIEW_MS);
  };

  const setOpen = (open: boolean) => {
    if (open === isOpen()) return;
    panel.hidden = !open;
    if (open) {
      unread = 0;
      hidePreview();
      renderLog(true);
      input.focus({ preventScroll: true });
    } else if (panel.contains(document.activeElement)) {
      // Back to where chat was opened from, when it can take focus; the board otherwise.
      if (!toggle.hidden && !toggle.closest("[inert]")) toggle.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement | null)?.blur();
    }
    renderToggle();
  };

  toggle.addEventListener("click", () => setOpen(!isOpen()));
  preview.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setOpen(false);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = cleanChat(input.value);
    if (!say || text === null) return;
    // Pressed again before the server has answered: the line is on its way already.
    if (text === sending && performance.now() - sentAt < RESEND_MS) return;
    if (!say(input.value)) return;
    sending = text;
    sentAt = performance.now();
  });
  // The same count as the server's: characters, not UTF-16 units, so emoji are not halved.
  input.addEventListener("input", () => {
    const chars = Array.from(input.value);
    if (chars.length > CHAT_MAX) input.value = chars.slice(0, CHAT_MAX).join("");
  });
  window.addEventListener("keydown", (event) => {
    if (!say || isOpen() || event.key !== "Enter" || event.repeat) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isTyping(event.target)) return;
    event.preventDefault();
    setOpen(true);
  });

  const view: ChatView = {
    start(send) {
      say = send;
      toggle.hidden = false;
      renderToggle();
      renderLog(true);
    },
    setLobby(next) {
      const renamed =
        lobby?.you !== next.you || JSON.stringify(lobby.players) !== JSON.stringify(next.players);
      lobby = next;
      if (renamed) renderLog(atBottom());
    },
    receive(messages) {
      if (!say) return;
      const merged = mergeChat(lines, messages);
      if (merged.added.length === 0 && primed) return;
      const stick = atBottom() || merged.added.some((line) => line.from === lobby?.you);
      lines = merged.log;
      renderLog(stick);
      // The server has kept the line in the field: it is said, so the field is cleared,
      // unless the player has started on something else meanwhile.
      if (merged.added.some((line) => line.from === lobby?.you && line.text === sending)) {
        if (cleanChat(input.value) === sending) input.value = "";
        sending = null;
      }
      const announce = primed;
      primed = true;
      if (!announce) return;
      const heard = merged.added.filter((line) => line.from !== lobby?.you);
      const last = heard.at(-1);
      if (!last) return;
      sfx.chatReceived();
      if (isOpen()) return;
      unread += heard.length;
      renderToggle();
      showPreview(last);
    },
    stop() {
      say = null;
      lobby = null;
      lines = [];
      primed = false;
      unread = 0;
      sending = null;
      input.value = "";
      setOpen(false);
      hidePreview();
      toggle.hidden = true;
      renderLog(true);
    },
  };
  return view;
}
