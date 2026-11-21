import type { CardId } from "../core/cards.ts";

/** One simple line drawing per card, on a 48 by 48 grid, drawn in the rarity colour. */
const ART: Record<CardId, string> = {
  // Two arrows chasing each other: roll again.
  reroll:
    '<path d="M38 22a14 14 0 0 0-25-6"/><path d="M13 8v8h8"/><path d="M10 26a14 14 0 0 0 25 6"/><path d="M35 40v-8h-8"/>',
  // A shield with a boss.
  shield:
    '<path d="M24 6l14 5v11c0 9-6 16-14 20-8-4-14-11-14-20V11z"/><circle cx="24" cy="22" r="4"/>',
  // A four-leaf clover.
  charm:
    '<circle cx="18" cy="17" r="6"/><circle cx="30" cy="17" r="6"/><circle cx="18" cy="29" r="6"/><circle cx="30" cy="29" r="6"/><path d="M24 30q1 8 7 12"/>',
  // The ground splitting.
  quake: '<path d="M4 18h10l5 8 6-14 5 20 5-10h9"/><path d="M8 38h32"/><path d="M14 44h20"/>',
  // A die showing six.
  loaded:
    '<rect x="8" y="8" width="32" height="32" rx="6"/><g fill="currentColor" stroke="none"><circle cx="17" cy="16" r="2.6"/><circle cx="31" cy="16" r="2.6"/><circle cx="17" cy="24" r="2.6"/><circle cx="31" cy="24" r="2.6"/><circle cx="17" cy="32" r="2.6"/><circle cx="31" cy="32" r="2.6"/></g>',
};

export function cardArt(card: CardId): string {
  return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ART[card]}</svg>`;
}
