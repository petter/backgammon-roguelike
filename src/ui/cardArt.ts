import type { CardId } from "../core/cards.ts";

/**
 * The card illustrations: small printed scenes on a 120 by 84 canvas. They share one
 * manner so the five read as a set: a subject standing in a simple landscape with the
 * horizon two thirds down, lit from the upper left, each with a cast shadow and a single
 * highlight. Shapes are edged in a darker shade of their own colour, as printed pictures
 * are, rather than in one black line, which makes a picture look like a sticker.
 */
const INK = "#2a1d14";
const LINE = 1.15;
/** An edge for a shape, in a darker shade of what it encloses. */
const edge = (color: string) =>
  `stroke="${color}" stroke-width="${LINE}" stroke-linejoin="round" stroke-linecap="round"`;

type Point = [number, number];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const n = (value: number) => value.toFixed(2);

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

interface DieLook {
  edge: string;
  top: string;
  left: string;
  right: string;
  pip: string;
}
const IVORY: DieLook = {
  edge: "#6f6040",
  top: "#fbf4e0",
  left: "#e3d6b4",
  right: "#c4b48c",
  pip: INK,
};
const GOLD: DieLook = {
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
function die(
  cx: number,
  cy: number,
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
    `<g transform="matrix(${n(u[0])} ${n(u[1])} ${n(v[0])} ${n(v[1])} ${n(origin[0])} ${n(origin[1])})" fill="${look.pip}">${PIPS[
      value
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.085"/>`)
      .join("")}</g>`;
  return `<g transform="rotate(${turn} ${cx} ${cy})">
${poly([topLeft, topBack, topRight, topFront], look.top)}${poly([topLeft, topFront, lowFront, lowLeft], look.left)}${poly([topFront, topRight, lowRight, lowFront], look.right)}
${pips(topLeft, sub(topBack, topLeft), sub(topFront, topLeft), faces[0])}${pips(topLeft, sub(topFront, topLeft), sub(lowLeft, topLeft), faces[1])}${pips(topFront, sub(topRight, topFront), sub(lowFront, topFront), faces[2])}
<path d="M${n(topLeft[0] + 1.2)} ${n(topLeft[1] + 0.2)}L${n(topFront[0] - 0.6)} ${n(topFront[1] - 0.9)}" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity="0.85" fill="none"/></g>`;
}

/** A checker lying flat or tipped: a short cylinder with a lit top. */
function checker(
  cx: number,
  cy: number,
  r: number,
  turn: number,
  top: string,
  side: string,
  rim: string,
  /** The streak of light on the top face: white on ivory, a muted grey on a dark checker. */
  shine = "#fff",
) {
  const ry = r * 0.42;
  const thick = r * 0.38;
  return `<g transform="rotate(${turn} ${cx} ${cy})">
<path d="M${n(cx - r)} ${n(cy)}v${n(thick)}a${n(r)} ${n(ry)} 0 0 0 ${n(2 * r)} 0v${n(-thick)}" fill="${side}" ${edge(rim)}/>
<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r)}" ry="${n(ry)}" fill="${top}" ${edge(rim)}/>
<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r * 0.62)}" ry="${n(ry * 0.62)}" fill="none" stroke="${rim}" stroke-width="0.6" opacity="0.6"/>
<path d="M${n(cx - r * 0.7)} ${n(cy - ry * 0.35)}q${n(r * 0.35)} ${n(-ry * 0.6)} ${n(r * 0.8)} ${n(-ry * 0.55)}" stroke="${shine}" stroke-width="0.9" stroke-linecap="round" opacity="0.7" fill="none"/></g>`;
}

const shadow = (cx: number, cy: number, rx: number, ry: number, opacity = 0.3) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="${opacity}"/>`;

/** A sky over rolling ground with the horizon two thirds down. */
function land(id: string, sky: [string, string], far: string, near: string): string {
  return `<defs><linearGradient id="art-${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
<rect width="120" height="84" fill="url(#art-${id}-sky)"/>
<path d="M0 58Q30 49 62 56T120 53V84H0z" fill="${far}"/><path d="M0 67Q42 59 82 66T120 63V84H0z" fill="${near}"/>`;
}

/** A ribbon of wind: a filled stroke that tapers to a point at both ends. */
const ribbon = (d: string, opacity: number) => `<path d="${d}" fill="#fff" opacity="${opacity}"/>`;

const star = (cx: number, cy: number, r = 0.9) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fdf6d8"/>`;

const leaf = (turn: number) =>
  `<g transform="rotate(${turn} 60 38)"><path d="M60 38C49 32 45 19 53 15c4-2 7 2 7 5 0-3 3-7 7-5 8 4 4 17-7 23z" fill="url(#art-charm-leaf)" ${edge("#1d5a2a")}/><path d="M60 37V21" stroke="#1d5a2a" stroke-width="0.8" fill="none"/><path d="M53 20q-3 4-1 9" stroke="#e4ffd0" stroke-width="1" stroke-linecap="round" opacity="0.75" fill="none"/></g>`;

const rays = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6 - 0.2;
  const b = a + Math.PI / 12;
  const at = (angle: number) => `${n(60 + 130 * Math.cos(angle))},${n(40 + 130 * Math.sin(angle))}`;
  return `<polygon points="60,40 ${at(a)} ${at(b)}" fill="#fff6d0" opacity="0.4"/>`;
}).join("");

const ART: Record<CardId, string> = {
  // Two dice lifted by a gust.
  reroll: `${land("reroll", ["#dcebe0", "#9cc4bd"], "#6c9d98", "#467a76")}
${ribbon("M4 26C26 14 48 30 70 20S100 9 116 17C100 13 88 22 71 23 50 34 27 20 4 26z", 0.75)}
${ribbon("M2 43C20 35 38 46 56 41c9-3 12-11 5-14 10 2 9 13-3 17C40 50 21 39 2 43z", 0.6)}
${ribbon("M50 10C66 4 86 8 102 3 88 9 68 7 50 10z", 0.5)}
${shadow(50, 71, 17, 3.2)}${shadow(95, 68, 13, 2.6, 0.24)}
${die(38, 44, 15, [5, 4, 6], IVORY, -14)}${die(84, 34, 12.5, [3, 1, 2], IVORY, 18)}`,

  // A shield planted in front of a lone checker.
  shield: `${land("shield", ["#ebe8c6", "#b4c690"], "#7fa066", "#557a45")}
<defs><linearGradient id="art-shield-light" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f1f4f5"/><stop offset="0.5" stop-color="#c2cad0"/><stop offset="0.5" stop-color="#99a3ab"/><stop offset="1" stop-color="#6b7680"/></linearGradient></defs>
${shadow(66, 74, 31, 4.2, 0.34)}
${shadow(94, 66.5, 13, 2.4, 0.3)}${checker(90, 60, 13, 0, "#f6ecd4", "#c9b78f", "#8a7850")}
<path d="M54 10L82 19V44c0 15-11 24-28 31C37 68 26 59 26 44V19z" fill="#5a3a22" ${edge("#33200f")}/>
<path d="M54 15L78 23V44c0 12-9 20-24 26C39 64 30 56 30 44V23z" fill="url(#art-shield-light)" ${edge("#4b555e")}/>
<path d="M50 16h8v52l-4 2-4-2z" fill="#8a5a2c" ${edge("#4f3216")}/><path d="M30 34h48v8H30z" fill="#8a5a2c" ${edge("#4f3216")}/>
<circle cx="54" cy="38" r="7" fill="#e0b84e" ${edge("#8a6a1c")}/><path d="M50 35q2-3 5-3" stroke="#fff6cf" stroke-width="1.2" stroke-linecap="round" fill="none"/>
<path d="M34 26V44c0 5 2 9 5 12" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity="0.8" fill="none"/>
<g fill="${INK}"><circle cx="37" cy="28" r="1.2"/><circle cx="71" cy="28" r="1.2"/><circle cx="40" cy="52" r="1.2"/><circle cx="68" cy="52" r="1.2"/></g>`,

  // A four-leaf clover on a hill under a crescent moon.
  charm: `${land("charm", ["#142447", "#3a67a3"], "#1c3a66", "#12233f")}
<defs><linearGradient id="art-charm-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a6e88a"/><stop offset="1" stop-color="#2f8f41"/></linearGradient></defs>
<path d="M99 9a11 11 0 1 0 9 17 9 9 0 1 1-9-17z" fill="#fdf6d8" ${edge("#b3a67c")}/>
${star(14, 13)}${star(30, 25, 0.7)}${star(20, 46, 0.8)}${star(106, 44, 0.8)}${star(86, 50, 0.7)}${star(46, 9, 0.6)}${star(74, 14, 0.7)}
${shadow(66, 72.5, 20, 3, 0.42)}
<path d="M60 40C61 52 62 62 60 72" fill="none" stroke="#1d5a2a" stroke-width="4" stroke-linecap="round"/><path d="M60 40C61 52 62 62 60 72" fill="none" stroke="#2f8f41" stroke-width="2.2" stroke-linecap="round"/>
${leaf(0)}${leaf(90)}${leaf(180)}${leaf(270)}<circle cx="60" cy="38" r="2.4" fill="#1d5a2a"/>`,

  // The ground splits and the checkers are thrown. The type line laps over the foot of the
  // picture, so everything that matters is kept above the bottom tenth.
  quake: `<defs><linearGradient id="art-quake-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1a47"/><stop offset="1" stop-color="#8468a8"/></linearGradient><linearGradient id="art-quake-felt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f8468"/><stop offset="1" stop-color="#27493a"/></linearGradient></defs>
<rect width="120" height="84" fill="url(#art-quake-sky)"/>
<path d="M0 50Q30 47 62 49T120 48V84H0z" fill="url(#art-quake-felt)"/><path d="M0 50Q30 47 62 49T120 48" stroke="${INK}" stroke-width="1" fill="none" opacity="0.6"/>
${shadow(24, 66, 14, 2.6, 0.36)}${shadow(101, 63, 14, 2.6, 0.36)}${shadow(66, 53.5, 8, 1.3, 0.26)}
<path d="M33 73l15-3 3 6-14 3z" fill="#3c6b54"/><path d="M33 73l15-3" stroke="#a7dcbd" stroke-width="1.1" stroke-linecap="round"/><path d="M37 79l14-3v3z" fill="#1c3a2d"/>
<path d="M77 69l14 2-2 6-13-2z" fill="#3c6b54"/><path d="M77 69l14 2" stroke="#a7dcbd" stroke-width="1.1" stroke-linecap="round"/><path d="M76 75l13 2-1 2z" fill="#1c3a2d"/>
<path d="M62 55l-4 6 3 4-8 5 3 5-9 9h29l-5-9 4-4-8-5 2-5z" fill="#0b1711"/>
<path d="M62 55l7 6-2 5 8 5-4 4 5 9" stroke="#8eb294" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" fill="none"/>
<path d="M62 55l-4 6 3 4-8 5 3 5-9 9" stroke="#060d0a" stroke-width="1" stroke-linejoin="round" fill="none"/>
<g stroke="#0b1711" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M58 61l-6-2-4 1"/><path d="M53 70l-9-2-5 1"/><path d="M75 71l8-2 5 1"/><path d="M69 61l4-3"/><path d="M62 55l1-3"/></g>
<g fill="#a9bcae" stroke="#5f7568" stroke-width="0.8" stroke-linejoin="round"><path d="M22 77c-2-4 3-7 6-4 1-4 8-3 8 1 3 0 3 4 0 4z"/><path d="M88 78c-1-4 3-6 6-4 1-3 7-2 6 2 3 0 3 3 0 3z"/></g>
${checker(26, 31, 15, -17, "#efe2c4", "#c2af84", "#6f5d36")}${checker(98, 23, 15, 21, "#3a322c", "#17110d", "#050404", "#8a857d")}${checker(60, 16, 11.5, -5, "#efe2c4", "#c2af84", "#6f5d36")}`,

  // A golden die with a six on every face.
  loaded: `<defs><radialGradient id="art-loaded-sun" cx="0.5" cy="0.48" r="0.8"><stop offset="0" stop-color="#fff0b8"/><stop offset="1" stop-color="#e08a22"/></radialGradient></defs>
<rect width="120" height="84" fill="url(#art-loaded-sun)"/>${rays}
<path d="M0 62Q40 56 80 61T120 59V84H0z" fill="#b8641a"/><path d="M0 62Q40 56 80 61T120 59" stroke="${INK}" stroke-width="1" fill="none" opacity="0.5"/>
${shadow(73, 67, 27, 4.4, 0.4)}
${die(60, 40, 26, [6, 6, 6], GOLD)}`,
};

export function cardArt(card: CardId): string {
  return `<svg viewBox="0 0 120 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${ART[card]}</svg>`;
}
