import type { CharacterId } from "../core/characters.ts";
import { characterArt } from "./characterArt.ts";

/** Gold for the winner's crest, cold iron for the loser's. */
const METALS = {
  victory: {
    light: "#fff4c4",
    mid: "#f2bf4f",
    dark: "#8a5512",
    pointA: "#7c2a1d",
    pointB: "#efe2c2",
  },
  defeat: {
    light: "#dfe5ec",
    mid: "#7f8a97",
    dark: "#2b3038",
    pointA: "#4a1c1c",
    pointB: "#9aa3ad",
  },
} as const;

export type Outcome = keyof typeof METALS;

const C = 100;

/** Where the loser's crest splits: from the rim down into the portrait. */
const CRACK = "M134 22l-10 23 8 9-15 20 6 8-13 19 4 12";
const SPLINTERS = "M124 45l-16-3-7 11M117 74l14 8M114 102l-11 6";

function polar(radius: number, degrees: number): string {
  const a = ((degrees - 90) * Math.PI) / 180;
  return `${(C + radius * Math.cos(a)).toFixed(2)},${(C + radius * Math.sin(a)).toFixed(2)}`;
}

/** Twenty-four points around the rim, like the board's, alternating in two colours. */
function points(a: string, b: string): string {
  return Array.from({ length: 24 }, (_, i) => {
    const start = i * 15;
    const corners = [polar(73, start + 1), polar(73, start + 14), polar(57, start + 7.5)];
    return `<polygon points="${corners.join(" ")}" fill="${i % 2 ? b : a}"/>`;
  }).join("");
}

/** A laurel branch curving up one side of the crest. `side` is -1 for left, 1 for right. */
function laurel(side: -1 | 1): string {
  const leaves = Array.from({ length: 9 }, (_, i) => {
    const deg = 180 - side * (28 + i * 15);
    const a = ((deg - 90) * Math.PI) / 180;
    const x = C + 90 * Math.cos(a);
    const y = C + 90 * Math.sin(a);
    const tilt = deg + side * 40;
    const size = 1 - i * 0.045;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(5 * size).toFixed(1)}" ry="${(11 * size).toFixed(1)}" transform="rotate(${tilt.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join("");
  return `<g class="go-laurel" fill="url(#go-metal)" stroke="#0006" stroke-width="0.8">${leaves}</g>`;
}

/**
 * The medallion shown on the result screen: a rim of board points around the character's
 * portrait. The winner's is gold with laurels; the loser's is iron, and cracks.
 */
export function crestArt(outcome: Outcome, character: CharacterId): string {
  const m = METALS[outcome];
  const portrait = characterArt(character).replace(
    "<svg ",
    '<svg x="57" y="57" width="86" height="86" class="go-portrait" ',
  );
  const victory = outcome === "victory";
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
    <defs>
      <linearGradient id="go-metal" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${m.light}"/>
        <stop offset="0.45" stop-color="${m.mid}"/>
        <stop offset="0.7" stop-color="${m.dark}"/>
        <stop offset="1" stop-color="${m.mid}"/>
      </linearGradient>
      <radialGradient id="go-glow">
        <stop offset="0.55" stop-color="${m.mid}" stop-opacity="0.55"/>
        <stop offset="1" stop-color="${m.mid}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="100" cy="100" r="100" fill="url(#go-glow)"/>
    ${victory ? laurel(-1) + laurel(1) : ""}
    <circle cx="100" cy="100" r="80" fill="url(#go-metal)" stroke="#0008" stroke-width="1.5"/>
    <circle cx="100" cy="100" r="74" fill="#1a1310"/>
    ${points(m.pointA, m.pointB)}
    <circle cx="100" cy="100" r="56" fill="none" stroke="url(#go-metal)" stroke-width="3"/>
    ${portrait}
    <path d="M100 8l9 12-9 12-9-12z" fill="url(#go-metal)" stroke="#0008" stroke-width="1.2"/>
    ${
      victory
        ? ""
        : `<g fill="none" stroke-linejoin="bevel" stroke-linecap="round">
            <path class="go-crack" pathLength="1" d="${CRACK}" stroke="#e8eef5" stroke-width="6.5" opacity="0.55"/>
            <path class="go-crack" pathLength="1" d="${CRACK}" stroke="#08080a" stroke-width="4"/>
            <path class="go-crack" pathLength="1" d="${SPLINTERS}" stroke="#08080a" stroke-width="2.4"/>
          </g>`
    }
  </svg>`;
}
