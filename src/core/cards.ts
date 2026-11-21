/** From most to least common. The stronger a card, the fewer copies a deck holds. */
export const RARITIES = {
  common: { name: "Common", copies: 4 },
  uncommon: { name: "Uncommon", copies: 3 },
  rare: { name: "Rare", copies: 2 },
  epic: { name: "Epic", copies: 1 },
  legendary: { name: "Legendary", copies: 1 },
} as const;

export type Rarity = keyof typeof RARITIES;

/**
 * Printed on the card's type line. `Dice` cards change your roll; `Tactic` cards the board.
 * A `Curse` hexes the opponent's next roll; a `Ward` answers curses; a `Trap` is set face
 * down and springs on something the opponent does; `Tempo` works on your cards; `Wild` is
 * a gamble.
 */
export type CardKind = "Dice" | "Tactic" | "Curse" | "Ward" | "Trap" | "Tempo" | "Wild";

interface CardDefinition {
  name: string;
  kind: CardKind;
  rarity: Rarity;
  text: string;
}

/** Dice cards share one rule: if a card leaves you with exactly two matching dice, they are doubles. */
export const CARDS = {
  reroll: {
    name: "Second Wind",
    kind: "Dice",
    rarity: "common",
    text: "Reroll your remaining dice. A pair counts as doubles.",
  },
  shield: {
    name: "Bulwark",
    kind: "Tactic",
    rarity: "uncommon",
    text: "Your lone checkers cannot be hit until your next turn.",
  },
  charm: {
    name: "Lucky Charm",
    kind: "Dice",
    rarity: "rare",
    text: "Roll one extra die. A pair counts as doubles.",
  },
  quake: {
    name: "Quake",
    kind: "Tactic",
    rarity: "epic",
    text: "Send every lone enemy checker in your home board to the bar.",
  },
  loaded: {
    name: "Loaded Die",
    kind: "Dice",
    rarity: "legendary",
    text: "Your lowest remaining die becomes a 6. A pair counts as doubles.",
  },
  leadWeight: {
    name: "Lead Weight",
    kind: "Curse",
    rarity: "common",
    text: "Hex: on their next roll, their highest die drops by 1.",
  },
  horseshoe: {
    name: "Iron Horseshoe",
    kind: "Ward",
    rarity: "common",
    text: "Blocks the next hex cast on you.",
  },
  sageSmoke: {
    name: "Sage Smoke",
    kind: "Ward",
    rarity: "common",
    text: "Before or after rolling: lift one hex. If none, reroll your lowest die.",
  },
  chisel: {
    name: "Chisel",
    kind: "Dice",
    rarity: "common",
    text: "Split your highest die into two that add up to it. Never doubles.",
  },
  quietStep: {
    name: "Quiet Step",
    kind: "Tactic",
    rarity: "common",
    text: "Your rearmost checker steps 1 point forward. Uses no die; cannot hit.",
  },
  looseBoard: {
    name: "Loose Board",
    kind: "Trap",
    rarity: "common",
    text: "Trap: when they get doubles, one of the four dice is lost.",
  },
  keenEye: {
    name: "Keen Eye",
    kind: "Tempo",
    rarity: "common",
    text: "Your next pick offers four cards instead of three.",
  },
  coinToss: {
    name: "Coin Toss",
    kind: "Wild",
    rarity: "common",
    text: "Heads: roll one extra die. Tails: lose your lowest die.",
  },
  backstep: {
    name: "Backstep",
    kind: "Curse",
    rarity: "rare",
    text: "Hex: next turn, their first checker move goes backwards if it can.",
  },
  flipBones: {
    name: "Flip the Bones",
    kind: "Dice",
    rarity: "rare",
    text: "Turn each remaining die to its opposite face: 1 for 6, 2 for 5, 3 for 4.",
  },
  mirror: {
    name: "Glass Mirror",
    kind: "Ward",
    rarity: "rare",
    text: "The next hex cast on you rebounds onto the caster.",
  },
  counterpunch: {
    name: "Counterpunch",
    kind: "Trap",
    rarity: "rare",
    text: "Trap: when they hit one of your checkers, the hitter goes to the bar too.",
  },
  crackedDice: {
    name: "Cracked Dice",
    kind: "Curse",
    rarity: "epic",
    text: "Hex: their next roll is three dice, highest dropped. Never doubles.",
  },
  curseEater: {
    name: "Curse Eater",
    kind: "Ward",
    rarity: "epic",
    text: "Before or after rolling: lift every hex on you and roll a die for each.",
  },
  shackles: {
    name: "Shackles of Greed",
    kind: "Curse",
    rarity: "legendary",
    text: "Hex: their highest die drops by 1 every roll, until they hit you or roll doubles.",
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

/** Curses: cast on the opponent, they bite when that player next rolls. */
export type HexId = "leadWeight" | "backstep" | "crackedDice" | "shackles";
/** Wards that stand on the table, in plain sight, until a hex sets them off. */
export type WardId = "horseshoe" | "mirror";
/** Traps: set face down, they spring on something the opponent does. */
export type TrapId = "looseBoard" | "counterpunch";

export function isHex(card: CardId): card is HexId {
  return CARDS[card].kind === "Curse";
}

export function isTrap(card: CardId): card is TrapId {
  return CARDS[card].kind === "Trap";
}

/** How many traps a player may have set at once. */
export const TRAP_LIMIT = 2;
