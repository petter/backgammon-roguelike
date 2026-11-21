import { CHARACTERS, type CharacterId } from "../core/characters.ts";

/** Each character's emblem, drawn in cream on a 48 by 48 medallion of its own colour. */
const EMBLEMS: Record<CharacterId, { colour: string; rim: string; emblem: string }> = {
  gambler: {
    colour: "#8f2f2a",
    rim: "#d9a441",
    emblem: `<rect x="14" y="14" width="20" height="20" rx="4.5" fill="#f3ead6" transform="rotate(-12 24 24)"/>
      <g fill="#5c1c19" transform="rotate(-12 24 24)">
        <circle cx="19" cy="19" r="1.9"/><circle cx="29" cy="19" r="1.9"/><circle cx="24" cy="24" r="1.9"/>
        <circle cx="19" cy="29" r="1.9"/><circle cx="29" cy="29" r="1.9"/>
      </g>`,
  },
  sentinel: {
    colour: "#2f4f72",
    rim: "#b9c4cf",
    emblem: `<path d="M24 11l11 4v8.5c0 6.6-4.4 11.6-11 14-6.6-2.4-11-7.4-11-14V15z" fill="#f3ead6"/>
      <path d="M24 15.5v17.5M16.5 22.5h15" stroke="#2f4f72" stroke-width="2.6" stroke-linecap="round"/>`,
  },
  seer: {
    colour: "#55357a",
    rim: "#c9a5e8",
    emblem: `<path d="M9.5 24c4-6.5 9-9.5 14.5-9.5S34.5 17.5 38.5 24c-4 6.5-9 9.5-14.5 9.5S13.5 30.5 9.5 24z" fill="#f3ead6"/>
      <circle cx="24" cy="24" r="5.8" fill="#55357a"/><circle cx="24" cy="24" r="2.3" fill="#f3ead6"/>`,
  },
  corsair: {
    colour: "#1f5f5b",
    rim: "#e0c27a",
    emblem: `<g fill="none" stroke="#f3ead6" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="24" cy="13.5" r="2.8"/><path d="M24 16.5V36M18.5 21.5h11"/>
        <path d="M12.5 27c1 5.5 5.5 9 11.5 9s10.5-3.5 11.5-9"/><path d="M10.5 29.5l2-3 3 2M37.5 29.5l-2-3-3 2"/>
      </g>`,
  },
};

/** A round portrait for a character. Fixed markup from our own source, never user input. */
export function characterArt(character: CharacterId): string {
  const { colour, rim, emblem } = EMBLEMS[character];
  return `<svg viewBox="0 0 48 48" role="img" aria-label="${CHARACTERS[character].name}">
    <circle cx="24" cy="24" r="23" fill="${rim}"/>
    <circle cx="24" cy="24" r="20.5" fill="${colour}"/>
    <circle cx="24" cy="24" r="20.5" fill="none" stroke="#0005" stroke-width="1"/>
    ${emblem}
  </svg>`;
}
