import type { CardId } from "../core/cards.ts";
import {
  checker,
  die,
  EBONY_CHECKER,
  edge,
  GOLD,
  INK,
  IVORY,
  IVORY_CHECKER,
  land,
  n,
  ribbon,
  shadow,
  star,
} from "./artKit.ts";
import { TAVERN_ART } from "./cardArtTavern.ts";

/** The core set's illustrations, drawn in the manner `artKit.ts` describes. */
const leaf = (turn: number) =>
  `<g transform="rotate(${turn} 60 38)"><path d="M60 38C49 32 45 19 53 15c4-2 7 2 7 5 0-3 3-7 7-5 8 4 4 17-7 23z" fill="url(#art-charm-leaf)" ${edge("#1d5a2a")}/><path d="M60 37V21" stroke="#1d5a2a" stroke-width="0.8" fill="none"/><path d="M53 20q-3 4-1 9" stroke="#e4ffd0" stroke-width="1" stroke-linecap="round" opacity="0.75" fill="none"/></g>`;

const rayPoint = (angle: number) =>
  `${n(60 + 130 * Math.cos(angle))},${n(40 + 130 * Math.sin(angle))}`;

const rays = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6 - 0.2;
  const b = a + Math.PI / 12;
  return `<polygon points="60,40 ${rayPoint(a)} ${rayPoint(b)}" fill="#fff6d0" opacity="0.4"/>`;
}).join("");

const CORE_ART = {
  // Two dice lifted by a gust.
  reroll: `${land("reroll", ["#dcebe0", "#9cc4bd"], "#6c9d98", "#467a76")}
${ribbon("M4 26C26 14 48 30 70 20S100 9 116 17C100 13 88 22 71 23 50 34 27 20 4 26z", 0.75)}
${ribbon("M2 43C20 35 38 46 56 41c9-3 12-11 5-14 10 2 9 13-3 17C40 50 21 39 2 43z", 0.6)}
${ribbon("M50 10C66 4 86 8 102 3 88 9 68 7 50 10z", 0.5)}
${shadow(50, 71, 17, 3.2)}${shadow(95, 68, 13, 2.6, 0.24)}
${die([38, 44], 15, [5, 4, 6], IVORY, -14)}${die([84, 34], 12.5, [3, 1, 2], IVORY, 18)}`,

  // A shield planted in front of a lone checker.
  shield: `${land("shield", ["#ebe8c6", "#b4c690"], "#7fa066", "#557a45")}
<defs><linearGradient id="art-shield-light" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f1f4f5"/><stop offset="0.5" stop-color="#c2cad0"/><stop offset="0.5" stop-color="#99a3ab"/><stop offset="1" stop-color="#6b7680"/></linearGradient></defs>
${shadow(66, 74, 31, 4.2, 0.34)}
${shadow(94, 66.5, 13, 2.4, 0.3)}${checker([90, 60], 13, 0, { top: "#f6ecd4", side: "#c9b78f", rim: "#8a7850", shine: "#fff" })}
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
${checker([26, 31], 15, -17, IVORY_CHECKER)}${checker([98, 23], 15, 21, EBONY_CHECKER)}${checker([60, 16], 11.5, -5, IVORY_CHECKER)}`,

  // A golden die with a six on every face.
  loaded: `<defs><radialGradient id="art-loaded-sun" cx="0.5" cy="0.48" r="0.8"><stop offset="0" stop-color="#fff0b8"/><stop offset="1" stop-color="#e08a22"/></radialGradient></defs>
<rect width="120" height="84" fill="url(#art-loaded-sun)"/>${rays}
<path d="M0 62Q40 56 80 61T120 59V84H0z" fill="#b8641a"/><path d="M0 62Q40 56 80 61T120 59" stroke="${INK}" stroke-width="1" fill="none" opacity="0.5"/>
${shadow(73, 67, 27, 4.4, 0.4)}
${die([60, 40], 26, [6, 6, 6], GOLD)}`,
};

const ART: Record<CardId, string> = { ...CORE_ART, ...TAVERN_ART };

export function cardArt(card: CardId): string {
  return `<svg viewBox="0 0 120 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${ART[card]}</svg>`;
}
