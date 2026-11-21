import { must } from "../core/must.ts";

/**
 * The card illustrations: small printed scenes on a 120 by 84 canvas. They share one
 * manner so they read as a set: a subject standing in a simple landscape with the
 * horizon two thirds down, lit from the upper left, each with a cast shadow and a single
 * highlight. Shapes are edged in a darker shade of their own colour, as printed pictures
 * are, rather than in one black line, which makes a picture look like a sticker.
 */
export const INK = "#2a1d14";
export const LINE = 1.15;
/** An edge for a shape, in a darker shade of what it encloses. */
export const edge = (color: string) =>
  `stroke="${color}" stroke-width="${LINE}" stroke-linejoin="round" stroke-linecap="round"`;

export type Point = [number, number];
export const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
export const n = (value: number) => value.toFixed(2);

/** Where the pips of each face sit, in the face's own unit square. */
const PIPS: Record<number, Point[]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.5, 0.5],
    [0.25, 0.75],
    [0.75, 0.75],
  ],
  6: [
    [0.28, 0.22],
    [0.72, 0.22],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.78],
    [0.72, 0.78],
  ],
};

export interface DieLook {
  edge: string;
  top: string;
  left: string;
  right: string;
  pip: string;
}
export const IVORY: DieLook = {
  edge: "#6f6040",
  top: "#fbf4e0",
  left: "#e3d6b4",
  right: "#c4b48c",
  pip: INK,
};
export const GOLD: DieLook = {
  edge: "#7a4a0c",
  top: "#fff0b8",
  left: "#f0c95a",
  right: "#c9952b",
  pip: "#4a2c06",
};

/**
 * A die seen from above its front corner, `size` being the length of an edge on the page.
 * `faces` gives the values on the top, left and right faces. Pips are drawn in each face's
 * own plane, so they foreshorten with it.
 */
export function die(
  [cx, cy]: Point,
  size: number,
  faces: [number, number, number],
  look: DieLook,
  turn = 0,
): string {
  const w = size * 0.87;
  const h = size * 0.5;
  const topBack: Point = [cx, cy - size];
  const topRight: Point = [cx + w, cy - h];
  const topFront: Point = [cx, cy];
  const topLeft: Point = [cx - w, cy - h];
  const lowLeft: Point = [cx - w, cy + h];
  const lowFront: Point = [cx, cy + size];
  const lowRight: Point = [cx + w, cy + h];
  const poly = (points: Point[], fill: string) =>
    `<polygon points="${points.map((p) => `${n(p[0])},${n(p[1])}`).join(" ")}" fill="${fill}" ${edge(look.edge)}/>`;
  const pips = (origin: Point, u: Point, v: Point, value: number) =>
    `<g transform="matrix(${n(u[0])} ${n(u[1])} ${n(v[0])} ${n(v[1])} ${n(origin[0])} ${n(origin[1])})" fill="${look.pip}">${must(
      PIPS[value],
      `pips for ${value}`,
    )
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.085"/>`)
      .join("")}</g>`;
  return `<g transform="rotate(${turn} ${cx} ${cy})">
${poly([topLeft, topBack, topRight, topFront], look.top)}${poly([topLeft, topFront, lowFront, lowLeft], look.left)}${poly([topFront, topRight, lowRight, lowFront], look.right)}
${pips(topLeft, sub(topBack, topLeft), sub(topFront, topLeft), faces[0])}${pips(topLeft, sub(topFront, topLeft), sub(lowLeft, topLeft), faces[1])}${pips(topFront, sub(topRight, topFront), sub(lowFront, topFront), faces[2])}
<path d="M${n(topLeft[0] + 1.2)} ${n(topLeft[1] + 0.2)}L${n(topFront[0] - 0.6)} ${n(topFront[1] - 0.9)}" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity="0.85" fill="none"/></g>`;
}

export interface CheckerLook {
  top: string;
  side: string;
  rim: string;
  /** The streak of light on the top face: white on ivory, a muted grey on a dark checker. */
  shine: string;
}

export const IVORY_CHECKER: CheckerLook = {
  top: "#efe2c4",
  side: "#c2af84",
  rim: "#6f5d36",
  shine: "#fff",
};
export const EBONY_CHECKER: CheckerLook = {
  top: "#3a322c",
  side: "#17110d",
  rim: "#050404",
  shine: "#8a857d",
};

/** A checker lying flat or tipped: a short cylinder with a lit top. */
export function checker([cx, cy]: Point, r: number, turn: number, look: CheckerLook) {
  const { top, side, rim, shine } = look;
  const ry = r * 0.42;
  const thick = r * 0.38;
  return `<g transform="rotate(${turn} ${cx} ${cy})">
<path d="M${n(cx - r)} ${n(cy)}v${n(thick)}a${n(r)} ${n(ry)} 0 0 0 ${n(2 * r)} 0v${n(-thick)}" fill="${side}" ${edge(rim)}/>
<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r)}" ry="${n(ry)}" fill="${top}" ${edge(rim)}/>
<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r * 0.62)}" ry="${n(ry * 0.62)}" fill="none" stroke="${rim}" stroke-width="0.6" opacity="0.6"/>
<path d="M${n(cx - r * 0.7)} ${n(cy - ry * 0.35)}q${n(r * 0.35)} ${n(-ry * 0.6)} ${n(r * 0.8)} ${n(-ry * 0.55)}" stroke="${shine}" stroke-width="0.9" stroke-linecap="round" opacity="0.7" fill="none"/></g>`;
}

export const shadow = (cx: number, cy: number, rx: number, ry: number, opacity = 0.3) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="${opacity}"/>`;

/** A sky over rolling ground with the horizon two thirds down. */
export function land(id: string, sky: [string, string], far: string, near: string): string {
  return `<defs><linearGradient id="art-${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
<rect width="120" height="84" fill="url(#art-${id}-sky)"/>
<path d="M0 58Q30 49 62 56T120 53V84H0z" fill="${far}"/><path d="M0 67Q42 59 82 66T120 63V84H0z" fill="${near}"/>`;
}

/** A ribbon of wind or smoke: a filled stroke that tapers to a point at both ends. */
export const ribbon = (d: string, opacity: number, color = "#fff") =>
  `<path d="${d}" fill="${color}" opacity="${opacity}"/>`;

export const star = (cx: number, cy: number, r = 0.9) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fdf6d8"/>`;
