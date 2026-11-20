export const CARDS = {
  reroll: { name: "Second Wind", text: "Reroll your remaining dice." },
  loaded: { name: "Loaded Die", text: "Your lowest remaining die becomes a 6." },
  charm: { name: "Lucky Charm", text: "Roll one extra die." },
  shield: { name: "Bulwark", text: "Your lone checkers cannot be hit until your next turn." },
  quake: { name: "Quake", text: "Send every lone enemy checker in your home board to the bar." },
} as const;

export type CardId = keyof typeof CARDS;

export const CARD_IDS = Object.keys(CARDS) as CardId[];

export function isCardId(value: unknown): value is CardId {
  return typeof value === "string" && Object.hasOwn(CARDS, value);
}

/** Every player starts with two copies of each card. */
export function starterDeck(): CardId[] {
  return CARD_IDS.flatMap((id) => [id, id]);
}
