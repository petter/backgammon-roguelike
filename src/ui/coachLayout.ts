/** Where the coach's card goes on screen: pure geometry, in client pixels. */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function boxOf(outline: Point[]): Box {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

export const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export interface CardScene {
  /** The window's size. */
  w: number;
  h: number;
  /** The board, tray included. */
  board: Box;
  /** The player's outer board: where the card goes inside the board if it must. */
  room: Box;
  /** The band of the window the board is drawn in, between the HUD's rows. */
  field: { top: number; bottom: number };
  /** The lit area. The card must not cover it. */
  spot: Box;
  /** The tag on or beside the lit area, which the card must not cover either. */
  tag: Box | null;
}

export interface CardPlace {
  width: number;
  at: Point;
}

/** Gap between the card and what it sits beside. */
export const GAP = 20;
export const MARGIN = 16;
/** The gap a card beside the board keeps from it, and from the window's edge. */
const SIDE = 24;
/** The card's width above or below the board, where it can spread out. */
const WIDE = 540;
/** Its width beside the board or inside it, and the least width worth using there. */
const NARROW = 380;
const NARROWEST = 280;

/**
 * Picks the card's place. `measure` sets the card to a width and says how tall it then is.
 *
 * In order of preference: off the board above or below it, on the side where the HUD
 * leaves more room; beside it in the window's margin, the spot's side first; inside it, in the player's outer
 * board, which the route only skirts; at the window's top or bottom edge; or, as narrow
 * as it goes, against the window's left or right edge. The first
 * that fits the window and covers neither the spot nor the tag wins, or else the outer
 * board. Above or below the board the card may run over a row of the HUD: it says what
 * to do next, so for those few seconds it matters more than the HUD does.
 */
export function placeCard(scene: CardScene, measure: (width: number) => number): CardPlace {
  const { w, h, board, room, field } = scene;
  const fit = (width: number) => Math.min(width, w - MARGIN * 2);
  const clampX = (x: number, cw: number) => Math.max(MARGIN, Math.min(w - MARGIN - cw, x));
  const clampY = (y: number, ch: number) => Math.max(MARGIN, Math.min(h - MARGIN - ch, y));
  // Measuring lays the card out, so each width is measured once, and only when a place
  // that needs it comes up for consideration.
  const heights = new Map<number, number>();
  const heightAt = (cw: number) => {
    const known = heights.get(cw);
    if (known !== undefined) return known;
    const ch = measure(cw);
    heights.set(cw, ch);
    return ch;
  };
  type Option = CardPlace & { ch: number };
  const options: Array<() => Option> = [];
  const add = (width: number, place: (cw: number, ch: number) => Point) => {
    options.push(() => {
      const cw = fit(width);
      const ch = heightAt(cw);
      return { width: cw, at: place(cw, ch), ch };
    });
  };

  const aboveFirst = board.top - field.top > field.bottom - board.bottom;
  const centred = (cw: number) => clampX((board.left + board.right - cw) / 2, cw);
  // Closer than GAP: the board's own outline already has a rim and a shadow round it.
  const above = (cw: number, ch: number) => ({ x: centred(cw), y: board.top - GAP / 2 - ch });
  const below = (cw: number) => ({ x: centred(cw), y: board.bottom + GAP / 2 });
  for (const end of aboveFirst ? [above, below] : [below, above]) add(WIDE, end);

  // Beside the board the card keeps a wider berth, from the board and from the window.
  const left = board.left - SIDE * 2;
  const right = w - board.right - SIDE * 2;
  const middle = (scene.spot.top + scene.spot.bottom) / 2;
  // Level with the spot, or failing that (a tag beside the tray may be in the way) against
  // the board's top or bottom edge.
  const tag = scene.tag;
  const levels = [
    (ch: number) => clampY(middle - ch / 2, ch),
    // Just above or below the tag, so the card still sits by what the tag names.
    ...(tag
      ? [
          (ch: number) => clampY(tag.top - GAP * 2 - ch, ch),
          (ch: number) => clampY(tag.bottom + GAP * 2, ch),
        ]
      : []),
    (ch: number) => clampY(board.top, ch),
    (ch: number) => clampY(board.bottom - ch, ch),
  ];
  const beside = [
    () => {
      if (left < NARROWEST) return;
      for (const y of levels)
        add(Math.min(NARROW, left), (cw, ch) => ({ x: board.left - SIDE - cw, y: y(ch) }));
    },
    () => {
      if (right < NARROWEST) return;
      for (const y of levels)
        add(Math.min(NARROW, right), (_, ch) => ({ x: board.right + SIDE, y: y(ch) }));
    },
  ];
  // The margin on the spot's own side first, so the card sits near what it describes.
  const spotRight = scene.spot.left + scene.spot.right > board.left + board.right;
  for (const side of spotRight ? beside.toReversed() : beside) side();

  // Inside the board: against the outer board's outer edge, clear of the lanes in the middle.
  const outward = (room.top + room.bottom) / 2 > (board.top + board.bottom) / 2;
  const inRoom = (cw: number, ch: number) => ({
    x: clampX((room.left + room.right - cw) / 2, cw),
    y: clampY(outward ? room.bottom - ch : room.top, ch),
  });
  add(NARROW, inRoom);
  const fallback = options.at(-1);
  add(NARROW, (cw) => ({ x: clampX((w - cw) / 2, cw), y: MARGIN }));
  add(NARROW, (cw, ch) => ({ x: clampX((w - cw) / 2, cw), y: h - MARGIN - ch }));
  // A short wide window, such as a phone on its side, has room only at the sides.
  add(NARROWEST, (_, ch) => ({ x: MARGIN, y: clampY(middle - ch / 2, ch) }));
  add(NARROWEST, (cw, ch) => ({ x: w - MARGIN - cw, y: clampY(middle - ch / 2, ch) }));

  const box = (o: Option): Box => ({
    left: o.at.x,
    right: o.at.x + o.width,
    top: o.at.y,
    bottom: o.at.y + o.ch,
  });
  const inWindow = (o: Option) => o.at.y >= MARGIN && o.at.y + o.ch <= h - MARGIN;
  const avoid = scene.tag ? [scene.spot, scene.tag] : [scene.spot];
  const free = (o: Option) => !avoid.some((b) => overlaps(box(o), b));
  for (const option of options) {
    const o = option();
    if (inWindow(o) && free(o)) return { width: o.width, at: o.at };
  }
  const last = fallback?.();
  return last
    ? { width: last.width, at: last.at }
    : { width: fit(NARROW), at: { x: MARGIN, y: MARGIN } };
}
