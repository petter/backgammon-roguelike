/** From most to least common. The stronger a card, the fewer copies a deck holds. */
export const RARITIES = {
  common: { name: "Common", copies: 4 },
  uncommon: { name: "Uncommon", copies: 3 },
  rare: { name: "Rare", copies: 2 },
  epic: { name: "Epic", copies: 1 },
  legendary: { name: "Legendary", copies: 1 },
} as const;

export type Rarity = keyof typeof RARITIES;

interface CardDefinition {
  name: string;
  rarity: Rarity;
  text: string;
}

/** Dice cards share one rule: if a card leaves you with exactly two matching dice, they are doubles. */
export const CARDS = {
  reroll: {
    name: "Second Wind",
    rarity: "common",
    text: "Reroll your remaining dice. A pair counts as doubles.",
  },
  shield: {
    name: "Bulwark",
    rarity: "uncommon",
    text: "Your lone checkers cannot be hit until your next turn.",
  },
  charm: {
    name: "Lucky Charm",
    rarity: "rare",
    text: "Roll one extra die. A pair counts as doubles.",
  },
  quake: {
    name: "Quake",
    rarity: "epic",
    text: "Send every lone enemy checker in your home board to the bar.",
  },
  loaded: {
    name: "Loaded Die",
    rarity: "legendary",
    text: "Your lowest remaining die becomes a 6. A pair counts as doubles.",
  },
} as const satisfies Record<string, CardDefinition>;

export type CardId = keyof typeof CARDS;

export const CARD_IDS = Object.keys(CARDS) as CardId[];

export function isCardId(value: unknown): value is CardId {
  return typeof value === "string" && Object.hasOwn(CARDS, value);
}

/** How many copies of a card a deck holds, set by its rarity. */
export function copiesOf(card: CardId): number {
  return RARITIES[CARDS[card].rarity].copies;
}

/** The deck every player starts with: each card as many times as its rarity allows. */
export function starterDeck(): CardId[] {
  return CARD_IDS.flatMap((id) => Array.from({ length: copiesOf(id) }, () => id));
}
