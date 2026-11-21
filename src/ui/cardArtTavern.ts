import type { CardId } from "../core/cards.ts";
import {
  checker,
  die,
  type DieLook,
  EBONY_CHECKER,
  edge,
  GOLD,
  INK,
  IVORY,
  IVORY_CHECKER,
  land,
  n,
  type Point,
  ribbon,
  shadow,
  star,
} from "./artKit.ts";

/**
 * The illustrations for the curses, wards, traps and tavern tricks, drawn in the manner
 * `artKit.ts` describes. Curses are set under dusk and storm skies, wards in daylight or
 * by a lamp, so a hand reads at a glance as mischief or protection.
 */

/** Old bone: ivory gone grey and yellow. */
const BONE: DieLook = {
  edge: "#5e5440",
  top: "#e8e0c8",
  left: "#c8bea2",
  right: "#a89e84",
  pip: INK,
};
/** A die gone dull under a curse. */
const DULL: DieLook = {
  edge: "#4a463c",
  top: "#c2bcac",
  left: "#9e9888",
  right: "#7f796a",
  pip: "#2b2620",
};

const glow = (id: string, color: string) =>
  `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="0.85"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;

const goldStops = `<stop offset="0" stop-color="#fff2c4"/><stop offset="0.35" stop-color="#f0c95a"/><stop offset="0.7" stop-color="#c9952b"/><stop offset="1" stop-color="#7a4a0c"/>`;

/** A pair of footprints at a point, the toes pointing along `angle` degrees. */
function footprint([x, y]: Point, angle: number, opacity: number): string {
  return `<g transform="rotate(${angle} ${x} ${y})" fill="#8a6a3c" opacity="${opacity}"><ellipse cx="${x}" cy="${y - 1.6}" rx="2.1" ry="1"/><ellipse cx="${x + 1.2}" cy="${y + 1.6}" rx="2.1" ry="1"/></g>`;
}

/**
 * Chain links strung along a curve from `a` to `b` sagging through `c`, alternately seen
 * face on and edge on. The link at `broken`, if any, is cracked open.
 */
function chain(a: Point, c: Point, b: Point, count: number, broken = -1): string {
  let out = "";
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
    const y = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
    const dx = 2 * u * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
    const dy = 2 * u * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const face = i % 2 === 0;
    const rx = 3.3;
    const ry = face ? 2 : 0.8;
    const dash = i === broken ? ` stroke-dasharray="7 2.4"` : "";
    out += `<g transform="rotate(${n(angle)} ${n(x)} ${n(y)})"><ellipse cx="${n(x)}" cy="${n(y)}" rx="${rx}" ry="${ry}" fill="none" stroke="#5a3408" stroke-width="2.4"${dash}/><ellipse cx="${n(x)}" cy="${n(y)}" rx="${rx}" ry="${ry}" fill="none" stroke="url(#art-shackles-gold)" stroke-width="1.4"${dash}/></g>`;
    if (i === broken) {
      out += `<g stroke="#fff6cf" stroke-width="0.8" stroke-linecap="round"><path d="M${n(x + 2)} ${n(y - 4)}l1.6-2.4"/><path d="M${n(x + 3.6)} ${n(y - 2.6)}l2.6-0.8"/><path d="M${n(x + 0.4)} ${n(y - 4.4)}l0-2.6"/></g>`;
    }
  }
  return out;
}

/** A manacle: a heavy gold cuff seen at a slant, its hinge towards the chain. */
function manacle([x, y]: Point, turn: number): string {
  return `<g transform="rotate(${turn} ${x} ${y})">
<ellipse cx="${x}" cy="${y}" rx="11" ry="5.4" fill="none" stroke="#5a3408" stroke-width="6.2"/>
<ellipse cx="${x}" cy="${y}" rx="11" ry="5.4" fill="none" stroke="url(#art-shackles-gold)" stroke-width="4.4"/>
<path d="M${x - 9} ${y - 3.6}q4-4.4 10-4.6" stroke="#fff8e6" stroke-width="1.1" stroke-linecap="round" fill="none"/>
<rect x="${x + 9}" y="${y - 2.4}" width="4" height="4.8" rx="1" fill="#c9952b" ${edge("#5a3408")}/></g>`;
}

export const TAVERN_ART = {
  // An iron weight bearing down on a die sunk into wet clay.
  leadWeight: `${land("leadWeight", ["#8b949c", "#c6cbc7"], "#7a6a55", "#58493a")}
<defs><linearGradient id="art-leadWeight-iron" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9aa0a8"/><stop offset="0.45" stop-color="#5b6068"/><stop offset="1" stop-color="#2f3238"/></linearGradient></defs>
<path d="M60 0V11" stroke="#b39a6a" stroke-width="1.3"/>
${shadow(64, 71, 21, 3.2, 0.38)}
<ellipse cx="60" cy="66" rx="17" ry="3.6" fill="#3f3328" opacity="0.8"/><ellipse cx="60" cy="66" rx="24" ry="5.2" fill="none" stroke="#3f3328" stroke-width="0.8" opacity="0.5"/>
${die([60, 54], 12, [5, 2, 3], IVORY)}
<path d="M42 66c3 1 4 3 2 4M78 66c-3 1-4 3-2 4" stroke="#3f3328" stroke-width="0.9" fill="none" opacity="0.7"/>
<circle cx="60" cy="13" r="4.2" fill="none" stroke="#3a3e44" stroke-width="2.2"/><circle cx="60" cy="13" r="4.2" fill="none" stroke="#8d939b" stroke-width="0.9"/>
<path d="M47 18h26l7 19c1 3-1 5-4 5H44c-3 0-5-2-4-5z" fill="url(#art-leadWeight-iron)" ${edge("#1e2024")}/>
<path d="M47 18h26l1.6 4.4H45.4z" fill="#b8bdc4" opacity="0.6"/>
<path d="M46 23l-4.6 13" stroke="#e4e8ec" stroke-width="1.2" stroke-linecap="round" opacity="0.8"/>
<g stroke="#e7ecf0" stroke-width="0.8" stroke-linecap="round" opacity="0.7"><path d="M50 45.5l-2 2.4"/><path d="M60 46v2.6"/><path d="M70 45.5l2 2.4"/></g>`,

  // An iron horseshoe nailed, heels up, to a fence post over a sunny pasture.
  horseshoe: `${land("horseshoe", ["#8fc0e0", "#f2e6b8"], "#86a862", "#5d8443")}
<defs><linearGradient id="art-horseshoe-post" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b08458"/><stop offset="0.6" stop-color="#8a6440"/><stop offset="1" stop-color="#5f4228"/></linearGradient></defs>
${shadow(80, 73, 28, 3.6, 0.36)}<path d="M73 74l30-6v3l-30 5z" fill="#000" opacity="0.18"/>
<path d="M47 14l13-4 13 4v60H47z" fill="url(#art-horseshoe-post)" ${edge("#4a321b")}/>
<path d="M51 20v52M58 18v54M68 20v52" stroke="#5f4228" stroke-width="0.6" opacity="0.6"/>
<path d="M47 14l13-4 13 4-13 3z" fill="#c9a274" ${edge("#4a321b")}/>
<path d="M49 17C44 31 46 46 60 47.5 74 46 76 31 71 17" stroke="#000" stroke-width="8.4" fill="none" opacity="0.22" transform="translate(2.6 2.2)"/>
<path d="M49 17C44 31 46 46 60 47.5 74 46 76 31 71 17" stroke="#33373d" stroke-width="8.4" fill="none"/>
<path d="M49 17C44 31 46 46 60 47.5 74 46 76 31 71 17" stroke="#8b929b" stroke-width="6" fill="none"/>
<path d="M49 17C44 31 46 46 60 47.5 74 46 76 31 71 17" stroke="#5d646d" stroke-width="1.4" stroke-dasharray="0.1 5.6" stroke-linecap="round" fill="none"/>
<rect x="44.6" y="13.4" width="9" height="4.6" rx="1" fill="#6b727b" ${edge("#33373d")}/><rect x="66.4" y="13.4" width="9" height="4.6" rx="1" fill="#6b727b" ${edge("#33373d")}/>
<path d="M46.6 22C44.6 31 46 39 50 43" stroke="#e2e6ea" stroke-width="1.2" stroke-linecap="round" fill="none"/>
<g stroke="#3f6b2f" stroke-width="1" stroke-linecap="round" fill="none"><path d="M42 74q1-5 3-7M44 74q0-4 2-6M76 74q-1-5-3-7M78 74q0-3 2-5"/></g>`,

  // A smouldering bundle of sage on a stone dish, its smoke curling up into a dusk sky.
  sageSmoke: `${land("sageSmoke", ["#3b2a5c", "#d98c5f"], "#4a3b5e", "#2e2540")}
<defs>${glow("art-sageSmoke-ember", "#ffb24a")}<linearGradient id="art-sageSmoke-leaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9cfb0"/><stop offset="1" stop-color="#6f8a6a"/></linearGradient></defs>
${star(16, 10, 0.8)}${star(34, 20, 0.6)}${star(104, 8, 0.7)}
${ribbon("M70 50C62 40 78 34 70 24S82 10 92 4C80 12 78 18 74 25 82 35 64 40 72 50z", 0.75, "#ece6f4")}
${ribbon("M74 48C80 40 72 34 82 26S96 18 104 18C94 20 90 24 85 28 76 34 84 41 75 49z", 0.45, "#ece6f4")}
${shadow(60, 71, 26, 3.4, 0.45)}
<ellipse cx="58" cy="64" rx="23" ry="5.6" fill="#7d776e" ${edge("#3e3a35")}/><ellipse cx="58" cy="62.6" rx="19" ry="3.8" fill="#a8a296" ${edge("#5e5950")}/>
<path d="M36 61.4c3-.6 6 .4 8 1.4" stroke="#e4ddd0" stroke-width="1" stroke-linecap="round" fill="none" opacity="0.8"/>
<g transform="rotate(-14 56 58)"><path d="M36 55c8-4 26-4 34-1 2 1 2 5 0 6-8 3-26 3-34-1-2-1-2-3 0-4z" fill="url(#art-sageSmoke-leaf)" ${edge("#44583f")}/>
<path d="M40 56c6 1 10 1 14 0M42 59c6 0 12 0 18-1M52 55c4 1 8 1 12 0" stroke="#4d6447" stroke-width="0.6" fill="none"/>
<rect x="46" y="53.4" width="2.6" height="7.6" rx="0.6" fill="#c9a46a" ${edge("#7a5a2c")}/><rect x="57" y="53" width="2.6" height="8.2" rx="0.6" fill="#c9a46a" ${edge("#7a5a2c")}/>
<path d="M38 55.6c4-1.6 9-2 14-2" stroke="#eef4ea" stroke-width="1" stroke-linecap="round" fill="none" opacity="0.8"/>
<g fill="url(#art-sageSmoke-leaf)" ${edge("#44583f")}><path d="M36 56c-6-5-10-4-13-1 4 1 8 3 13 3z"/><path d="M36 58c-6 2-9 6-9 9 4-2 7-5 10-7z"/><path d="M38 55c-3-6-7-8-11-7 3 2 6 5 9 8z"/></g></g>
<circle cx="71" cy="52" r="9" fill="url(#art-sageSmoke-ember)"/><circle cx="71" cy="52" r="2.4" fill="#ffd27a" ${edge("#c2501a")}/>`,

  // A brass chisel driven into a die, splitting it cleanly in two.
  chisel: `${land("chisel", ["#d7e8d2", "#9cc59a"], "#5f9a64", "#3f7a4a")}
<defs><linearGradient id="art-chisel-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#eef1f4"/><stop offset="1" stop-color="#7d858e"/></linearGradient><linearGradient id="art-chisel-brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4d58a"/><stop offset="1" stop-color="#a8741c"/></linearGradient><clipPath id="art-chisel-left"><rect x="0" y="0" width="60" height="84"/></clipPath><clipPath id="art-chisel-right"><rect x="60" y="0" width="60" height="84"/></clipPath></defs>
${shadow(46, 70, 14, 3, 0.36)}${shadow(78, 70, 14, 3, 0.36)}
<g clip-path="url(#art-chisel-left)"><g transform="translate(-7 2) rotate(-11 60 60)">${die([60, 52], 15, [2, 4, 2], IVORY)}</g></g>
<g clip-path="url(#art-chisel-right)"><g transform="translate(7 2) rotate(11 60 60)">${die([60, 52], 15, [4, 3, 1], IVORY)}</g></g>

<path d="M57.4 36l2.6 8 2.6-8-.6-14h-4z" fill="url(#art-chisel-steel)" ${edge("#4b555e")}/>
<rect x="56.4" y="4" width="7.2" height="17" rx="1.8" fill="url(#art-chisel-brass)" ${edge("#6b4a10")}/><rect x="55.4" y="19" width="9.2" height="3.4" rx="1" fill="#c9952b" ${edge("#6b4a10")}/>
<path d="M58 6v12" stroke="#fff4cf" stroke-width="1.1" stroke-linecap="round" opacity="0.85"/>
<g fill="#f6ecd4" ${edge("#8a7850")}><path d="M44 40l3-2 1 3z"/><path d="M74 38l3-1-1 3z"/><path d="M48 32l2-2 1 2z"/></g>
<g stroke="#fff" stroke-width="0.9" stroke-linecap="round" opacity="0.9"><path d="M50 30l-4-3"/><path d="M70 30l4-3"/><path d="M48 38l-5 0"/><path d="M72 38l5 0"/></g>`,

  // A lone checker hops from stone to stone towards a safe stack, under a pale dawn.
  quietStep: `${land("quietStep", ["#5f7f99", "#a9bfca"], "#6f927a", "#4c7258")}
<path d="M20 63Q30 40 44 48" stroke="#22303a" stroke-width="3.6" fill="none" opacity="0.4"/>
<path d="M20 63Q30 40 44 48" stroke="#fff" stroke-width="2" stroke-dasharray="2.4 2.6" stroke-linecap="round" fill="none" opacity="0.9"/>
<path d="M41.4 45.4l3 2.6-3.9.8" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.9"/>
<g><ellipse cx="20" cy="69" rx="11" ry="3.6" fill="#8d958c" ${edge("#4f574e")}/><path d="M11 68q9-3 18 0" stroke="#7fae6a" stroke-width="1.6" fill="none"/></g>
<g><ellipse cx="50" cy="66" rx="13" ry="4" fill="#8d958c" ${edge("#4f574e")}/><path d="M39 65q11-3.4 22 0" stroke="#7fae6a" stroke-width="1.6" fill="none"/></g>
<g><ellipse cx="86" cy="63" rx="15" ry="4.4" fill="#8d958c" ${edge("#4f574e")}/><path d="M73 62q13-3.6 26 0" stroke="#7fae6a" stroke-width="1.6" fill="none"/></g>
${shadow(56, 63.6, 14, 2.4, 0.32)}${checker([50, 56], 13.5, 0, IVORY_CHECKER)}
${shadow(92, 60.6, 13, 2.2, 0.3)}${checker([90, 57], 8, 0, IVORY_CHECKER)}${checker([90, 51.4], 8, 0, IVORY_CHECKER)}`,

  // Long floorboards; one has sprung up at its end. Three dice landed; the fourth drops
  // Long floorboards; one has sprung up like a lever. Three dice landed on the floor; the
  // Long floorboards under a cool lamplit wall; one board has sprung up like a lever. Three
  // dice landed; the fourth tumbles into the black gap the board left.
  looseBoard: `<defs><linearGradient id="art-looseBoard-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26303e"/><stop offset="1" stop-color="#4a5466"/></linearGradient><linearGradient id="art-looseBoard-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a6638"/><stop offset="1" stop-color="#6a3e1e"/></linearGradient><linearGradient id="art-looseBoard-plank" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0a868"/><stop offset="1" stop-color="#9a6436"/></linearGradient></defs>
<rect width="120" height="84" fill="url(#art-looseBoard-wall)"/>
<rect y="36" width="120" height="48" fill="url(#art-looseBoard-floor)"/>
<path d="M0 36h120" stroke="#1a0f08" stroke-width="1.4"/>
<g stroke="#3a2210" stroke-width="0.9"><path d="M0 48h120M0 62h120M0 76h120"/><path d="M100 36v12M14 76v8"/></g>
<g stroke="#c08a52" stroke-width="0.5" opacity="0.6" fill="none"><path d="M6 42q30 1.6 60 0M24 55q40 1.6 84 0M4 80q40 1.6 90 0"/></g>
<rect x="18" y="62.5" width="84" height="13.5" fill="#000"/>
${die([76, 70], 6.4, [6, 3, 5], IVORY, 34)}
<path d="M18 76.4l84-24 0 2.4-84 24z" fill="#4a2a12"/>
<path d="M18 62.5l84-24v14l-84 24z" fill="url(#art-looseBoard-plank)" ${edge("#3e2412")}/>
<path d="M22 64.6l76-21.6" stroke="#ffe0b0" stroke-width="0.9" opacity="0.85"/>
<g fill="#3e2412"><circle cx="24" cy="68.8" r="0.9"/><circle cx="96" cy="48" r="0.9"/></g>
${shadow(18, 52, 12, 2.4, 0.45)}${shadow(48, 47, 12, 2.4, 0.4)}
${shadow(108, 54, 9, 1.8, 0.4)}${die([16, 38], 12.5, [6, 4, 5], IVORY, -10)}${die([46, 32], 12.5, [6, 5, 3], IVORY, 8)}${die([106, 42], 10, [6, 2, 4], IVORY, 14)}
<g stroke="#f2e6cc" stroke-width="1.1" stroke-linecap="round" opacity="0.85"><path d="M72 52l2 6"/><path d="M80 52l-1 6"/><path d="M86 57l-3 4"/></g>`,

  // A brass magnifying glass over four fanned cards, a gold die swelling in the lens.
  keenEye: `<defs><linearGradient id="art-keenEye-paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3e4bc"/><stop offset="1" stop-color="#cfb27a"/></linearGradient><radialGradient id="art-keenEye-glass" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#f6fbff" stop-opacity="0.75"/><stop offset="1" stop-color="#a9c6d8" stop-opacity="0.35"/></radialGradient><clipPath id="art-keenEye-lens"><circle cx="66" cy="34" r="15"/></clipPath><linearGradient id="art-keenEye-brass" x1="0" y1="0" x2="1" y2="1">${goldStops}</linearGradient></defs>
<rect width="120" height="84" fill="#3a2414"/><path d="M0 44Q60 38 120 44V84H0z" fill="url(#art-keenEye-paper)"/><path d="M0 44Q60 38 120 44" stroke="#2a1a0e" stroke-width="1" fill="none"/>
${[-24, -8, 8, 24]
  .map(
    (turn, i) =>
      `<g transform="rotate(${turn} 60 110)"><rect x="50" y="${44 - (i === 3 ? 2 : 0)}" width="20" height="30" rx="2" fill="${i === 3 ? "#f6ecd4" : "#7a2a24"}" ${edge(i === 3 ? "#8a7850" : "#3e120e")}/><rect x="52.4" y="${46.4 - (i === 3 ? 2 : 0)}" width="15.2" height="25.2" rx="1.2" fill="none" stroke="${i === 3 ? "#c9952b" : "#e0b84e"}" stroke-width="0.8"/></g>`,
  )
  .join("")}
${shadow(74, 44, 15, 4, 0.22)}
<path d="M76 45l16 18" stroke="#3e2412" stroke-width="7" stroke-linecap="round"/><path d="M76 45l16 18" stroke="#8a5a2c" stroke-width="5" stroke-linecap="round"/><path d="M78 46l12 14" stroke="#c08850" stroke-width="1.2" stroke-linecap="round"/>
<g clip-path="url(#art-keenEye-lens)"><rect x="50" y="18" width="32" height="32" fill="#e9dfc8"/><rect x="56" y="20" width="20" height="28" rx="2" fill="#3f7fc9" ${edge("#1f4f93")}/><rect x="57.4" y="21.4" width="17.2" height="25.2" rx="1.2" fill="#f6ecd4"/><rect x="58.4" y="22.4" width="15.2" height="11" fill="#7fa8c9" ${edge("#4b6a85")}/><path d="M58.4 30q4-3 7.6-1t7.6-1.4V33.4H58.4z" fill="#4f8a5c"/><circle cx="70" cy="26" r="1.8" fill="#fff4cf"/><rect x="58.4" y="34.4" width="15.2" height="3" fill="#2a2017"/><path d="M60 39.6h12M60 42h10M60 44.4h11" stroke="#8a7850" stroke-width="0.8"/></g>
<circle cx="66" cy="34" r="15" fill="url(#art-keenEye-glass)"/>
<circle cx="66" cy="34" r="15.5" fill="none" stroke="#5a3408" stroke-width="4.4"/><circle cx="66" cy="34" r="15.5" fill="none" stroke="url(#art-keenEye-brass)" stroke-width="3"/>
<path d="M56 26a13 13 0 0 1 9-5" stroke="#fff" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.9"/>`,

  // A big gold coin spinning above a tavern table, a die waiting beneath it.
  coinToss: `<defs><linearGradient id="art-coinToss-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe3a6"/><stop offset="1" stop-color="#e0a050"/></linearGradient><linearGradient id="art-coinToss-gold" x1="0" y1="0" x2="1" y2="1">${goldStops}</linearGradient><linearGradient id="art-coinToss-table" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a6436"/><stop offset="1" stop-color="#5e3a1c"/></linearGradient></defs>
<rect width="120" height="84" fill="url(#art-coinToss-sky)"/>
<path d="M0 60h120v24H0z" fill="url(#art-coinToss-table)"/><path d="M0 60h120" stroke="#3e2412" stroke-width="1.2"/><path d="M0 61.4h120" stroke="#d29a5c" stroke-width="0.8" opacity="0.7"/>
<path d="M10 70q30-2 58 1M40 78q30-2 70 0" stroke="#4a2c14" stroke-width="0.6" fill="none" opacity="0.6"/>
<g stroke="#fff6d6" stroke-width="1.1" stroke-linecap="round" fill="none" opacity="0.8"><path d="M30 52Q22 34 34 18"/><path d="M90 52Q98 34 86 18"/></g>
${shadow(62, 71, 15, 2.6, 0.35)}${die([60, 60], 10.5, [3, 1, 2], IVORY, -8)}
<g transform="rotate(-18 60 28)"><ellipse cx="60" cy="31" rx="21" ry="12" fill="#8a5a12" ${edge("#4a2c06")}/><ellipse cx="60" cy="28" rx="21" ry="12" fill="url(#art-coinToss-gold)" ${edge("#6b4a10")}/><ellipse cx="60" cy="28" rx="16" ry="8.6" fill="none" stroke="#a8741c" stroke-width="1"/>
<path d="M51 31.4h18l1.6-8-5 3.6-3.6-6-3.6 6-5-3.6z" fill="#c9952b" ${edge("#7a4a0c")}/><g fill="#fff2c4"><circle cx="51.4" cy="23.6" r="1"/><circle cx="60" cy="20.4" r="1"/><circle cx="68.6" cy="23.6" r="1"/></g>
<path d="M43 24q8-6.6 20-7" stroke="#fffbe6" stroke-width="1.4" stroke-linecap="round" fill="none"/></g>
<g fill="#fffbe6"><path d="M98 12l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/><path d="M20 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></g>`,

  // A checker has slid back along its own track in the sand, away from home; its old print
  // lies ahead of it, and the arrow along the ground points the way it was made to go.
  backstep: `${land("backstep", ["#2c3566", "#9a8cb6"], "#cdb07a", "#b8955a")}
<ellipse cx="96" cy="70" rx="12" ry="3.6" fill="#9a7a48" opacity="0.6"/>
<ellipse cx="96" cy="70" rx="12" ry="3.6" fill="none" stroke="#fff3d6" stroke-width="1" stroke-dasharray="2.4 1.8" opacity="0.9"/>
<path d="M84 71.4H40" stroke="#9a7a48" stroke-width="5.4" stroke-linecap="round" opacity="0.55"/>
<path d="M84 71.4H40" stroke="#7a5a30" stroke-width="0.7" stroke-dasharray="1.4 2.2"/>
${footprint([104, 60], 180, 0.5)}${footprint([112, 62], 180, 0.4)}
${shadow(34, 70, 15, 2.8, 0.4)}${checker([30, 62], 13, -6, IVORY_CHECKER)}
<path d="M96 60C90 44 66 40 54 50l-1.4-4.6L44 56l11.6 2.6-2-4.6C64 46 84 48 90 62z" fill="#000" opacity="0.28" transform="translate(1 1.4)"/>
<path d="M96 60C90 44 66 40 54 50l-1.4-4.6L44 56l11.6 2.6-2-4.6C64 46 84 48 90 62z" fill="#fff3d6" ${edge("#8a6a3c")}/>
<path d="M90 55C84 47 70 45 60 49" stroke="#fff" stroke-width="0.9" stroke-linecap="round" fill="none" opacity="0.9"/>
${star(16, 10, 0.7)}${star(58, 8, 0.6)}${star(98, 14, 0.8)}
<path d="M106 18a7 7 0 1 0 6 11 5.6 5.6 0 1 1-6-11z" fill="#efe6c8" ${edge("#9a8e6a")}/>`,

  // The same die before and after a half turn: a 1 on top becomes a 6.
  flipBones: `<defs><linearGradient id="art-flipBones-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16213e"/><stop offset="1" stop-color="#46608a"/></linearGradient><linearGradient id="art-flipBones-felt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f8462"/><stop offset="1" stop-color="#1f4a35"/></linearGradient></defs>
<rect width="120" height="84" fill="url(#art-flipBones-sky)"/>
${star(14, 10, 0.7)}${star(60, 6, 0.6)}${star(104, 12, 0.8)}
<path d="M0 58Q60 54 120 58V84H0z" fill="url(#art-flipBones-felt)"/><path d="M0 58Q60 54 120 58" stroke="${INK}" stroke-width="1" fill="none" opacity="0.6"/>
${shadow(30, 70, 15, 2.6, 0.36)}${shadow(92, 70, 15, 2.6, 0.36)}
${die([28, 50], 14, [1, 2, 4], IVORY)}${die([90, 50], 14, [6, 5, 3], IVORY)}
<path d="M44 30C50 14 70 14 76 30" stroke="#000" stroke-width="4.6" stroke-linecap="round" fill="none" opacity="0.3" transform="translate(0.8 1.2)"/>
<path d="M44 30C50 14 70 14 76 30" stroke="#fff3d6" stroke-width="2.8" stroke-linecap="round" fill="none"/>
<path d="M70.6 27.6l5.4 2.8 2-5.6" stroke="#fff3d6" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,

  // A gilded hand mirror planted on a ridge throws a violet hex back into the storm.
  mirror: `${land("mirror", ["#241d40", "#7a5a8a"], "#b8792e", "#8a5420")}
<defs><linearGradient id="art-mirror-gold" x1="0" y1="0" x2="1" y2="1">${goldStops}</linearGradient><linearGradient id="art-mirror-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef4fb"/><stop offset="0.5" stop-color="#a9b9cc"/><stop offset="1" stop-color="#6c7d93"/></linearGradient></defs>
<path d="M0 8l12 6-4 4 14 6-2 3 20 4" stroke="#b07cff" stroke-width="4.4" stroke-linejoin="round" fill="none" opacity="0.35"/>
<path d="M0 8l12 6-4 4 14 6-2 3 20 4" stroke="#e2ccff" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
<path d="M44 33l-12 9 2 3-14 6 3 3-22 6" stroke="#b07cff" stroke-width="4.4" stroke-linejoin="round" fill="none" opacity="0.35"/>
<path d="M44 33l-12 9 2 3-14 6 3 3-22 6" stroke="#e2ccff" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
${shadow(66, 69, 16, 2.8, 0.4)}
<path d="M58 52v16" stroke="#5a3408" stroke-width="5.4" stroke-linecap="round"/><path d="M58 52v16" stroke="url(#art-mirror-gold)" stroke-width="3.6" stroke-linecap="round"/>
<circle cx="58" cy="54" r="3" fill="#f0c95a" ${edge("#5a3408")}/>
<ellipse cx="58" cy="32" rx="15.5" ry="20" fill="url(#art-mirror-gold)" ${edge("#5a3408")}/>
<ellipse cx="58" cy="32" rx="11.6" ry="16" fill="url(#art-mirror-glass)" ${edge("#5a3408")}/>
<path d="M50 22l8-6M50 30l13-11" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>
<circle cx="58" cy="11.4" r="2" fill="#fff2c4" ${edge("#7a4a0c")}/>
<g fill="#f6e6ff"><path d="M45 32l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z"/></g>`,

  // An ebony checker that struck an ivory one is flung off by a spring sprung from the felt.
  counterpunch: `<defs><linearGradient id="art-counterpunch-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c48a5a"/><stop offset="1" stop-color="#e8c08a"/></linearGradient><linearGradient id="art-counterpunch-felt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f8468"/><stop offset="1" stop-color="#27493a"/></linearGradient><linearGradient id="art-counterpunch-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f1f4f5"/><stop offset="1" stop-color="#6b7680"/></linearGradient></defs>
<rect width="120" height="84" fill="url(#art-counterpunch-sky)"/>
<path d="M0 54Q60 50 120 54V84H0z" fill="url(#art-counterpunch-felt)"/><path d="M0 54Q60 50 120 54" stroke="${INK}" stroke-width="1" fill="none" opacity="0.6"/>
<path d="M47 68h26l-2 5H49z" fill="#0b1711"/><path d="M73 68l9-10 2 2-9 11z" fill="#8a5a2c" stroke="#3e2412" stroke-width="0.9" stroke-linejoin="round"/>
<path d="M60 70l-7-3 14-3-14-3 14-3-14-3 14-3-14-3 7-2" stroke="#2a3138" stroke-width="3" stroke-linejoin="round" fill="none"/>
<path d="M60 70l-7-3 14-3-14-3 14-3-14-3 14-3-14-3 7-2" stroke="url(#art-counterpunch-steel)" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
<path d="M50 44h20v-3H50z" fill="#8b929b" ${edge("#2a3138")}/>
<g fill="none" stroke-linecap="round"><ellipse cx="63" cy="28" rx="9" ry="6" stroke="#fff8e0" stroke-width="2"/><ellipse cx="63" cy="28" rx="14" ry="9.4" stroke="#fff8e0" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/></g><circle cx="63" cy="28" r="2.6" fill="#fff8e0"/>
${checker([42, 28], 12, -28, IVORY_CHECKER)}${checker([86, 20], 12, 36, EBONY_CHECKER)}
<g stroke="#fff3d6" stroke-width="1.1" stroke-linecap="round" opacity="0.8"><path d="M98 8l8-4"/><path d="M102 16l9-1"/><path d="M28 18l-7-4"/></g>
${shadow(54, 72, 26, 3, 0.3)}`,

  // Three old bone dice on cracked slate; the one showing six has split in two.
  crackedDice: `${land("crackedDice", ["#1e1a24", "#4a4250"], "#4c535a", "#353b41")}
<defs><clipPath id="art-crackedDice-left"><rect x="0" y="0" width="40" height="84"/></clipPath><clipPath id="art-crackedDice-right"><rect x="40" y="0" width="80" height="84"/></clipPath></defs>
<g stroke="#1a1d21" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M6 72l10 2 8-3 10 4"/><path d="M44 66l4 5-2 5 6 4"/><path d="M84 70l8 3 6-2 12 3"/></g>
${star(14, 12, 0.7)}${star(60, 6, 0.6)}${star(104, 10, 0.7)}
${shadow(42, 68, 18, 3, 0.5)}${shadow(84, 64, 9, 1.8, 0.45)}${shadow(106, 66, 9, 1.8, 0.45)}
<g clip-path="url(#art-crackedDice-left)"><g transform="translate(-3 1) rotate(-6 40 50)">${die([40, 50], 15, [6, 5, 4], BONE)}</g></g>
<g clip-path="url(#art-crackedDice-right)"><g transform="translate(3 1.6) rotate(7 40 50)">${die([40, 50], 15, [6, 5, 4], BONE)}</g></g>
<path d="M38 34l2 6-1.4 6 2 6-1.6 6 1.6 6 -1 6" stroke="#0d0b10" stroke-width="2.2" stroke-linejoin="round" fill="none"/>
<g fill="#b8ae94" ${edge("#5e5440")}><path d="M36 70l3-1 1 2.4-3 1z"/><path d="M46 72l2.4 0 0 2-2.4 0z"/><path d="M41 66l2-1 .8 1.6-2 .8z"/></g>
<g fill="#8a826e" opacity="0.8"><circle cx="50" cy="66" r="0.8"/><circle cx="54" cy="62" r="0.6"/><circle cx="30" cy="66" r="0.7"/><circle cx="56" cy="69" r="0.5"/></g>
${die([84, 54], 8, [2, 3, 1], BONE, -8)}${die([106, 56], 8, [1, 4, 2], BONE, 6)}`,

  // A brass lantern draws violet wisps in at its vents and spills gold dice from its door.
  curseEater: `${land("curseEater", ["#241838", "#5b3d70"], "#3b2c48", "#261c32")}
<defs>${glow("art-curseEater-light", "#ffcf6a")}<linearGradient id="art-curseEater-brass" x1="0" y1="0" x2="1" y2="0">${goldStops}</linearGradient></defs>
${ribbon("M0 34C12 24 20 34 30 26S46 10 56 16C46 14 40 22 33 27 22 36 12 27 0 34z", 0.7, "#b98cff")}${ribbon("M6 14C14 10 20 16 26 12 22 16 14 16 6 14z", 0.5, "#d8bfff")}
${ribbon("M120 34C108 24 100 34 90 26S74 10 64 16C74 14 80 22 87 27 98 36 108 27 120 34z", 0.7, "#b98cff")}${ribbon("M114 14C106 10 100 16 94 12 98 16 106 16 114 14z", 0.5, "#d8bfff")}

<circle cx="60" cy="40" r="26" fill="url(#art-curseEater-light)"/>
${shadow(66, 70, 20, 3, 0.45)}
<path d="M60 4a5 5 0 0 1 0 10" stroke="#5a3408" stroke-width="2.6" fill="none"/><path d="M60 4a5 5 0 0 1 0 10" stroke="url(#art-curseEater-brass)" stroke-width="1.4" fill="none"/>
<path d="M50 20l10-7 10 7z" fill="url(#art-curseEater-brass)" ${edge("#5a3408")}/>
<rect x="48" y="20" width="24" height="4" rx="1" fill="#c9952b" ${edge("#5a3408")}/>
<rect x="50" y="24" width="20" height="30" fill="#ffe7a0" ${edge("#5a3408")}/>
<rect x="53" y="27" width="14" height="24" fill="#fff6d0"/>
<path d="M60 24v30M50 39h20" stroke="#8a5a12" stroke-width="1.6"/>
<rect x="48" y="54" width="24" height="5" rx="1" fill="url(#art-curseEater-brass)" ${edge("#5a3408")}/>
<path d="M51 26v26" stroke="#fffbe6" stroke-width="1" stroke-linecap="round" opacity="0.8"/>
${shadow(32, 72, 11, 2, 0.45)}${shadow(90, 72, 11, 2, 0.45)}
<path d="M72 58q8 2 12 0" stroke="#ffd27a" stroke-width="1.2" stroke-linecap="round" fill="none" opacity="0.8"/><path d="M48 58q-8 2-12 0" stroke="#ffd27a" stroke-width="1.2" stroke-linecap="round" fill="none" opacity="0.8"/>${die([30, 62], 9.6, [5, 3, 1], GOLD, -14)}${die([90, 62], 9.6, [3, 2, 6], GOLD, 16)}`,

  // Gold manacles chained to a dulled die on a windswept bluff; one link is cracking.
  shackles: `<defs><linearGradient id="art-shackles-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1830"/><stop offset="0.6" stop-color="#7a3440"/><stop offset="1" stop-color="#c8603a"/></linearGradient><linearGradient id="art-shackles-gold" x1="0" y1="0" x2="1" y2="1">${goldStops}</linearGradient></defs>
<rect width="120" height="84" fill="url(#art-shackles-sky)"/>
${ribbon("M0 20C30 14 50 24 80 18S110 12 120 14C100 16 88 22 76 23 50 28 28 18 0 20z", 0.45)}
<path d="M0 60Q34 54 70 58T120 56V84H0z" fill="#6e3a1c"/><path d="M0 60Q34 54 70 58T120 56" stroke="${INK}" stroke-width="1" fill="none" opacity="0.5"/>
${shadow(64, 72, 26, 3.8, 0.45)}
${die([60, 52], 17, [6, 5, 4], DULL)}
${chain([26, 64], [38, 66], [55, 36], 7, 3)}${chain([65, 36], [84, 62], [96, 64], 7)}
<circle cx="60" cy="35.4" r="3.2" fill="none" stroke="#5a3408" stroke-width="2.8"/><circle cx="60" cy="35.4" r="3.2" fill="none" stroke="url(#art-shackles-gold)" stroke-width="1.5"/>
${shadow(20, 69, 12, 2.4, 0.4)}${shadow(102, 69, 12, 2.4, 0.4)}${manacle([18, 64], -6)}${manacle([102, 64], 6)}`,
} satisfies Partial<Record<CardId, string>>;
