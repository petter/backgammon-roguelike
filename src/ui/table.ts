import "./table.css";
import type { Player } from "../core/board.ts";
import { createCard } from "./card.ts";
import { el } from "./dom.ts";
import type { Mark } from "./marks.ts";

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Where the board is drawn, in client pixels, and whose edge of it is nearest the viewer. */
export interface TableGeometry {
  board: Rect;
  /** The felt the checkers stand on, inside the rails: cards never lie over it. */
  play: Rect;
  /** The part of the window the board is drawn in, clear of the HUD. */
  field: Rect;
  near: Player;
}

export interface TableSide {
  player: Player;
  /** How the close-up names whose side it is: "you" or "Ada". */
  owner: string;
  marks: Mark[];
}

export interface TableView {
  render: (sides: TableSide[]) => void;
  /** Puts each side's cards in place again, as after the board has moved or resized. */
  layout: () => void;
  /** Puts away a card shown up close, as when a pass-and-play turn hands the device over. */
  dismiss: () => void;
  clear: () => void;
}

/** Room between the cards and the board's edge, and between neighbouring cards. */
const GAP = 8;

/** The size of a card lying on the table: smaller on a phone, whose board is small too. */
function cardSize(): { w: number; h: number } {
  const w = window.innerWidth <= 640 || window.innerHeight <= 500 ? 40 : 52;
  return { w, h: Math.round(w * 1.413) };
}

/** The smallest a card shrinks to where room is short, as on a short phone. */
const MIN_H = 20;

/**
 * Where one side's cards lie: above or below the board where the window leaves room
 * there, as on a phone held upright; else in the space to the board's left; else at the
 * board's edge, over its rail but never its felt, shrunk to fit.
 */
function placeSide(row: HTMLElement, at: TableGeometry, near: boolean): void {
  const { board, play, field } = at;
  let { w, h } = cardSize();
  const style = row.style;
  style.removeProperty("top");
  style.removeProperty("bottom");
  style.removeProperty("width");
  const roomAbove = board.top - field.top;
  const roomBelow = field.bottom - board.bottom;
  const roomLeft = board.left - field.left;
  // Out to the felt's edge, the rail included, less a little gap on either side.
  const railRoom = Math.min(play.top - field.top, field.bottom - play.bottom) - 8;
  const across = Math.max(w, Math.min(board.right, window.innerWidth - GAP) - board.left);
  style.setProperty("--table-w", `${w}px`);
  if (Math.min(roomAbove, roomBelow) >= h + GAP * 2) {
    row.dataset.place = "edge";
    style.left = `${Math.max(GAP, board.left)}px`;
    style.width = `${across}px`;
    if (near) style.top = `${board.bottom + GAP}px`;
    else style.bottom = `${window.innerHeight - board.top + GAP}px`;
  } else if (roomLeft >= w + GAP * 3) {
    row.dataset.place = "side";
    const width = roomLeft - GAP * 3;
    style.left = `${board.left - GAP * 2 - width}px`;
    style.width = `${width}px`;
    if (near) style.bottom = `${window.innerHeight - board.bottom}px`;
    else style.top = `${board.top}px`;
  } else {
    row.dataset.place = "rail";
    h = Math.max(MIN_H, Math.min(h, railRoom));
    w = Math.round(h / 1.413);
    style.setProperty("--table-w", `${w}px`);
    style.left = `${Math.max(GAP, board.left)}px`;
    style.width = `${across}px`;
    if (near) style.top = `${play.bottom + 4}px`;
    else style.bottom = `${window.innerHeight - play.top + 4}px`;
  }
}

/** A card on the table: face up, or the back of one. Pressed, it is shown up close. */
function tableCard(mark: Mark, onOpen: () => void): HTMLButtonElement {
  let button: HTMLButtonElement;
  if (mark.faceDown || !mark.card) {
    button = document.createElement("button");
    button.type = "button";
    const back = document.createElement("span");
    back.className = "card-back";
    button.append(back);
    button.classList.add("table-back");
  } else {
    button = createCard(mark.card);
  }
  button.classList.add("table-card", `table-${mark.kind}`);
  button.setAttribute("aria-label", `${mark.label}${mark.faceDown ? ", face down" : ""}`);
  button.title = mark.label;
  button.addEventListener("click", onOpen);
  return button;
}

/**
 * The cards lying on the table in front of each player, at their own edge of the board, so
 * both players can see what is in play. Any of them can be pressed to see it up close.
 */
export function createTable(locate: () => TableGeometry | null): TableView {
  const root = el("table");
  const rows = new Map<Player, HTMLElement>();
  let shown: TableSide[] = [];
  const zoom = createZoom();

  const rowFor = (player: Player) => {
    let row = rows.get(player);
    if (!row) {
      row = document.createElement("div");
      row.className = "table-side";
      rows.set(player, row);
      root.append(row);
    }
    return row;
  };

  const layout = () => {
    const at = locate();
    for (const [player, row] of rows) {
      if (!at || row.childElementCount === 0) continue;
      const near = player === at.near;
      row.dataset.near = String(near);
      placeSide(row, at, near);
    }
  };

  window.addEventListener("resize", layout);
  const stageEl = document.getElementById("stage");
  if (stageEl && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(layout).observe(stageEl);
  }

  return {
    render(sides) {
      // Only redrawn when something changed, so a card being pointed at is not replaced.
      if (JSON.stringify(sides) === JSON.stringify(shown)) {
        layout();
        return;
      }
      shown = sides;
      for (const side of sides) {
        const row = rowFor(side.player);
        row.setAttribute(
          "aria-label",
          side.owner === "you" ? "On the table in front of you" : `In front of ${side.owner}`,
        );
        // Only a card that has just been laid down lands; the others lie still.
        const before = new Set([...row.children].map((card) => (card as HTMLElement).dataset.key));
        const seen = new Map<string, number>();
        row.replaceChildren(
          ...side.marks.map((mark) => {
            const id = `${mark.kind}:${mark.card ?? "hidden"}`;
            const nth = (seen.get(id) ?? 0) + 1;
            seen.set(id, nth);
            const key = `${id}:${nth}`;
            // Focus goes back to this card after the close-up, even if the row was redrawn.
            const find = () => row.querySelector<HTMLElement>(`[data-key="${key}"]`);
            const card = tableCard(mark, () => zoom.open(mark, side.owner, find));
            card.dataset.key = key;
            if (!before.has(key)) card.classList.add("table-new");
            return card;
          }),
        );
      }
      layout();
    },
    layout,
    dismiss: () => zoom.close(),
    clear() {
      shown = [];
      zoom.close();
      for (const row of rows.values()) row.replaceChildren();
    },
  };
}

/** A table card shown up close, with what it does. Any press or Escape puts it back. */
function createZoom(): {
  open: (mark: Mark, owner: string, returnTo: () => HTMLElement | null) => void;
  close: () => void;
} {
  const root = document.createElement("div");
  root.id = "table-zoom";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "table-zoom-title");
  root.hidden = true;
  const holder = document.createElement("div");
  holder.className = "table-zoom-card";
  const caption = document.createElement("div");
  caption.className = "table-zoom-caption";
  const kicker = document.createElement("p");
  kicker.className = "table-zoom-kicker";
  const title = document.createElement("h2");
  title.id = "table-zoom-title";
  const detail = document.createElement("p");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "table-zoom-close";
  close.textContent = "Close";
  caption.append(kicker, title, detail, close);
  root.append(holder, caption);
  document.body.append(root);

  let returnTo: (() => HTMLElement | null) | null = null;
  const hide = () => {
    if (root.hidden) return;
    root.hidden = true;
    // Nothing of the card is left behind, even hidden: it may be a secret trap.
    holder.replaceChildren();
    kicker.textContent = "";
    title.textContent = "";
    detail.textContent = "";
    returnTo?.()?.focus();
    returnTo = null;
  };
  root.addEventListener("click", hide);
  root.addEventListener("keydown", (event) => {
    // While it is open, keys belong to it: E must not end the turn behind it.
    event.stopPropagation();
    if (event.key === "Escape") hide();
    // Close is the one thing to reach; Tab stays on it.
    if (event.key === "Tab") {
      event.preventDefault();
      close.focus();
    }
  });

  return {
    open(mark, owner, from) {
      returnTo = from;
      root.className = `table-zoom-${mark.kind}`;
      let card: HTMLElement;
      if (mark.card) {
        card = createCard(mark.card, undefined, true);
        card.tabIndex = -1;
      } else {
        card = document.createElement("span");
        card.className = "card-back table-zoom-back";
      }
      holder.replaceChildren(card);
      const where = owner === "you" ? "In front of you" : `In front of ${owner}`;
      const kind = { hex: "Hex", ward: "Ward", trap: "Trap, face down", boon: "In play" }[
        mark.kind
      ];
      kicker.textContent = `${where} · ${kind}`;
      title.textContent = mark.label;
      detail.textContent = mark.title;
      root.hidden = false;
      close.focus({ focusVisible: false });
    },
    close: hide,
  };
}
