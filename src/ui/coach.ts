import "./coach.css";
import { type Box, boxOf, MARGIN, overlaps, placeCard, type Point } from "./coachLayout.ts";
import { el } from "./dom.ts";
import { prefersLessMotion } from "./gameOver.ts";

export type { Point } from "./coachLayout.ts";

export interface CoachText {
  /** Whose checkers the card is about: shown as a small disc of their colour. */
  swatch: "white" | "black";
  /** The line under the body saying how to go on. */
  hint: string;
  /** A button to go on with, for a card that waits for the player. */
  action?: string;
  kicker: string;
  title: string;
  body: string;
  /** A short word laid over the lit area of the board. */
  tag: string;
}

export interface CoachOptions {
  /** Seconds the card stays up unless dismissed sooner; none to wait for the player. */
  hold: number | null;
  /** Called once the card has been dismissed or has timed out. Not called by `hide`. */
  onDone: () => void;
  /** Called after the card has been laid out again for a new window size. */
  onResize?: () => void;
  /**
   * Whether any press or key sends the card away. A card that comes mid-turn says so only
   * when it has done its job, as a press on the board may be part of play.
   */
  pressDismisses: boolean;
}

/** Where things are on screen, in client pixels. */
export interface CoachPlaces {
  /** The outline of the area being explained. The card never covers it. */
  spot: Point[];
  /** More outlines left undimmed along with the spot, such as the route leading to it. */
  lit: Point[][];
  /** Outlines inside the lit areas dimmed after all, such as the opponent's checkers. */
  shaded: Point[][];
  /** Elements of the page left undimmed too, such as the dice the card talks about. */
  keep: Element[];
  /**
   * Where the tag may sit, best first. It takes the first spot where it fits inside the
   * window, or else the last one, pushed back inside. A tag set off to the side of what it
   * names points `toward` it.
   */
  tag: Array<{ at: Point; toward: Point | null }>;
  /** The board's outline, tray included. The card sits beside it if there is space. */
  board: Point[];
  /** Where the card goes when there is no space beside the board: inside it, off the route. */
  room: Point[];
  /** The part of the window the board is drawn in, clear of the HUD's top and bottom rows. */
  field: { top: number; bottom: number };
}

export interface Coach {
  /**
   * Puts the card up and dims the screen round the spot `locate` gives. The places are
   * asked for again whenever the window changes size.
   */
  show: (text: CoachText, locate: () => CoachPlaces, options: CoachOptions) => void;
  /** Takes everything down at once, without calling `onDone`. */
  hide: () => void;
  /** Changes what the card up now says, keeping its place in time. */
  retext: (text: CoachText) => void;
  /** Sends the card away as a press would, calling `onDone`. */
  dismiss: () => void;
}

const SVG = "http://www.w3.org/2000/svg";
/** Room left round the lit area, in pixels, so its glowing frame is not dimmed too. */
const PAD = 18;
/**
 * A press this soon after the card appears does not send it away: it may be the press
 * that called it up, and the card should be seen at least for a moment.
 */
const GRACE_MS = 900;

/** Pushes every corner of an outline away from its middle by `pad` pixels. */
function grow(outline: Point[], pad: number): Point[] {
  const cx = outline.reduce((sum, p) => sum + p.x, 0) / outline.length;
  const cy = outline.reduce((sum, p) => sum + p.y, 0) / outline.length;
  return outline.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / length) * pad, y: p.y + (dy / length) * pad };
  });
}

/** Which side of the tag its caret goes on, to point from `at` to `toward`. */
function caretFor(at: Point, toward: Point): string {
  const dx = toward.x - at.x;
  const dy = toward.y - at.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

/** The HUD's parts, which step aside where the card lies over them. */
const hudItems = () => document.querySelectorAll<HTMLElement>("#hud .row > *");

const pathOf = (outline: Point[]) =>
  `${outline.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join("")}Z`;

/**
 * The dim layer: the window darkened everywhere except the lit outlines. They are cut out
 * of a mask rather than of the shape itself, so that outlines may overlap, and the mask is
 * blurred so the light fades out at their edges.
 */
function createDim(): {
  svg: SVGSVGElement;
  draw: (holes: Point[][], shades: Point[][]) => void;
} {
  const svg = document.createElementNS(SVG, "svg");
  svg.classList.add("coach-dim");
  svg.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(SVG, "defs");
  const blur = document.createElementNS(SVG, "filter");
  blur.id = "coach-blur";
  const gaussian = document.createElementNS(SVG, "feGaussianBlur");
  gaussian.setAttribute("stdDeviation", "12");
  blur.append(gaussian);
  const mask = document.createElementNS(SVG, "mask");
  mask.id = "coach-mask";
  // The mask's region otherwise starts 10% up and left of the window, leaving its far
  // edges undimmed.
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("x", "0");
  mask.setAttribute("y", "0");
  const open = document.createElementNS(SVG, "rect");
  open.setAttribute("fill", "#fff");
  const cut = document.createElementNS(SVG, "path");
  cut.setAttribute("fill", "#000");
  cut.setAttribute("filter", "url(#coach-blur)");
  mask.append(open, cut);
  defs.append(blur, mask);
  const shade = document.createElementNS(SVG, "rect");
  shade.classList.add("coach-shade");
  shade.setAttribute("mask", "url(#coach-mask)");
  // Shade laid back over parts of the holes, softened like their edges.
  const over = document.createElementNS(SVG, "path");
  over.classList.add("coach-shade-over");
  over.setAttribute("filter", "url(#coach-blur)");
  svg.append(defs, shade, over);
  return {
    svg,
    draw(holes, shades) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      for (const rect of [open, shade]) {
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(h));
      }
      mask.setAttribute("width", String(w));
      mask.setAttribute("height", String(h));
      cut.setAttribute("d", holes.map(pathOf).join(""));
      over.setAttribute("d", shades.map(pathOf).join(""));
    },
  };
}

/**
 * Gives back the parts of the HUD the card covered. Only those the coach itself covered:
 * the result screen makes parts of the HUD inert too.
 */
function release(): void {
  for (const item of document.querySelectorAll<HTMLElement>(".coach-covered")) {
    item.classList.remove("coach-covered");
    item.inert = false;
  }
  for (const item of document.querySelectorAll(".coach-kept")) item.classList.remove("coach-kept");
}

/**
 * The card that tells a player what to aim for, with the rest of the screen dimmed round
 * the part of the board it is about. It never takes clicks: the board stays playable
 * underneath, and any press or key sends the card away.
 */
export function createCoach(): Coach {
  const root = el("coach");
  const card = el("coach-card");
  const kicker = el("coach-kicker");
  const title = el("coach-title");
  const body = el("coach-body");
  const tag = el("coach-tag");
  const timer = el("coach-timer");
  const hint = el("coach-hint");
  const begin = el("coach-begin", HTMLButtonElement);
  const dim = createDim();
  root.prepend(dim.svg);

  let locate: (() => CoachPlaces) | null = null;
  let done: (() => void) | null = null;
  let shownAt = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let leaving: ReturnType<typeof setTimeout> | undefined;
  let listeners: AbortController | null = null;

  /** Puts the tag on the first of its spots where it fits, kept inside the window. */
  const placeTag = (spots: CoachPlaces["tag"]): Box | null => {
    const w = window.innerWidth;
    // Layout sizes: the tag's entrance scales it, which must not skew the measure.
    const half = tag.offsetWidth / 2;
    const fits = (at: Point) => at.x - half >= MARGIN && at.x + half <= w - MARGIN;
    const spot = spots.find((s) => fits(s.at)) ?? spots.at(-1);
    if (!spot) return null;
    const { at, toward } = spot;
    const caret = toward ? caretFor(at, toward) : "";
    tag.dataset.caret = caret;
    const x = Math.max(MARGIN + half, Math.min(w - MARGIN - half, at.x));
    // A tag pushed in from the window's edge still points at what it names, not past it.
    if (toward && (caret === "up" || caret === "down")) {
      const inset = Math.max(12, Math.min(half * 2 - 12, toward.x - (x - half)));
      tag.style.setProperty("--caret-x", `${inset}px`);
    } else {
      tag.style.removeProperty("--caret-x");
    }
    tag.style.left = `${x}px`;
    tag.style.top = `${at.y}px`;
    const height = tag.offsetHeight;
    return { left: x - half, right: x + half, top: at.y - height / 2, bottom: at.y + height / 2 };
  };

  const layout = () => {
    if (!locate) return;
    const places = locate();
    const spot = grow(places.spot, PAD);
    for (const element of places.keep) element.classList.add("coach-kept");
    const kept = places.keep.flatMap((element) => {
      const r = element.getBoundingClientRect();
      // An element that has emptied, such as the dice once spent, leaves no lit hole.
      if (r.width === 0 || r.height === 0) return [];
      return [
        [
          { x: r.left, y: r.top },
          { x: r.right, y: r.top },
          { x: r.right, y: r.bottom },
          { x: r.left, y: r.bottom },
        ],
      ];
    });
    dim.draw(
      [spot, ...[...places.lit, ...kept].map((outline) => grow(outline, PAD / 2))],
      places.shaded,
    );
    const tagBox = placeTag(places.tag);
    const awayEl = document.getElementById("opponent-away");
    const awayBottom =
      awayEl && !awayEl.hidden ? Math.ceil(awayEl.getBoundingClientRect().bottom + 8) : 0;
    const place = placeCard(
      {
        w: window.innerWidth,
        h: window.innerHeight,
        board: boxOf(places.board),
        room: boxOf(places.room),
        field: places.field,
        spot: boxOf(spot),
        tag: tagBox,
      },
      (width) => {
        card.style.width = `${width}px`;
        return card.offsetHeight;
      },
    );
    const cardTop = awayBottom > 0 ? Math.max(place.at.y, awayBottom) : place.at.y;
    card.style.width = `${place.width}px`;
    card.style.left = `${place.at.x}px`;
    card.style.top = `${cardTop}px`;
    if (awayBottom > 0) {
      card.style.maxHeight = `${Math.max(80, window.innerHeight - cardTop - 8)}px`;
      card.style.overflowY = "auto";
    } else {
      card.style.removeProperty("max-height");
      card.style.removeProperty("overflow-y");
    }
    // Whatever of the HUD the card lies over steps aside, rather than peek out round it.
    const over = {
      left: place.at.x,
      right: place.at.x + place.width,
      top: cardTop,
      bottom: cardTop + card.offsetHeight,
    };
    for (const item of hudItems()) {
      const rect = item.getBoundingClientRect();
      const covered = rect.width > 0 && overlaps(rect, over);
      if (covered === item.classList.contains("coach-covered")) continue;
      item.classList.toggle("coach-covered", covered);
      // The card takes no clicks, so a tap on it would land on a hidden button beneath.
      item.inert = covered;
    }
  };

  /** What the card says now, to tell a real change from the same words again. */
  let written = "";
  /** Puts a lesson's words on the card. */
  const write = (text: CoachText) => {
    written = JSON.stringify(text);
    const swatch = document.createElement("span");
    swatch.className = `coach-swatch ${text.swatch}`;
    kicker.replaceChildren(swatch, text.kicker);
    title.textContent = text.title;
    // Die faces in the text are set larger, as the dice in the status line show them.
    body.replaceChildren(
      ...text.body.split(/([\u2680-\u2685])/u).map((part) => {
        if (!/^[\u2680-\u2685]$/u.test(part)) return part;
        const die = document.createElement("span");
        die.className = "coach-die";
        die.textContent = part;
        return die;
      }),
    );
    hint.textContent = text.hint;
    begin.hidden = !text.action;
    begin.textContent = text.action ?? "";
    tag.textContent = text.tag;
  };

  const takeDown = () => {
    clearTimeout(timeout);
    listeners?.abort();
    listeners = null;
    locate = null;
    root.classList.remove("on");
  };

  const dismiss = () => {
    if (!locate) return;
    const finish = done;
    done = null;
    takeDown();
    clearTimeout(leaving);
    // What the card covered stays out of reach while it fades, and whatever waited for it
    // comes after: a tap on the fading card must not land on something only now arriving.
    leaving = setTimeout(() => {
      root.hidden = true;
      release();
      finish?.();
    }, 400);
  };

  return {
    show(text, where, options) {
      takeDown();
      // A card replacing another starts clean: what the last one covered or kept is its own.
      release();
      clearTimeout(leaving);
      write(text);
      root.classList.toggle("waits", options.hold === null);
      if (options.hold !== null) timer.style.animationDuration = `${options.hold}s`;
      locate = where;
      done = options.onDone;
      shownAt = performance.now();
      root.hidden = false;
      root.classList.toggle("still", prefersLessMotion());
      layout();
      // Restart the entrance even if the card was already up.
      void root.offsetWidth;
      root.classList.add("on");

      listeners = new AbortController();
      const { signal } = listeners;
      const press = () => {
        if (performance.now() - shownAt >= GRACE_MS) dismiss();
      };
      if (options.pressDismisses) {
        window.addEventListener("pointerdown", press, { capture: true, signal });
        window.addEventListener("keydown", press, { capture: true, signal });
        // A click with no press before it, as assistive tools send.
        window.addEventListener("click", press, { capture: true, signal });
      }
      // The button means it at once, grace or no grace.
      begin.addEventListener("click", dismiss, { signal });
      window.addEventListener(
        "resize",
        () => {
          layout();
          options.onResize?.();
        },
        { signal },
      );
      // What stays lit can change size while the card is up, such as the dice being spent,
      // and `#stage` itself can refit when the disconnect banner appears or disappears.
      const watch = new ResizeObserver(() => {
        layout();
        options.onResize?.();
      });
      for (const element of where().keep) watch.observe(element);
      const stageEl = document.getElementById("stage");
      if (stageEl) watch.observe(stageEl);
      const awayBanner = document.getElementById("opponent-away");
      if (awayBanner) watch.observe(awayBanner);
      signal.addEventListener("abort", () => watch.disconnect());
      // The card is measured to place it; the display font may still be on its way.
      void document.fonts.ready.then(() => (signal.aborted ? null : layout()));
      if (options.hold !== null) timeout = setTimeout(dismiss, options.hold * 1000);
    },
    dismiss,
    retext(text) {
      if (!locate) return;
      // Only new words are written: the card is a live region, read out on every change.
      const words = JSON.stringify(text);
      if (words !== written) write(text);
      layout();
    },
    hide() {
      done = null;
      takeDown();
      clearTimeout(leaving);
      root.hidden = true;
      release();
    },
  };
}
