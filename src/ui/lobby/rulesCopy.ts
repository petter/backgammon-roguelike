import type { CardKind } from "../../core/cards.ts";

/**
 * The words of the "How to play" page on the start screen. Plain text only: it is set with
 * `textContent`, never parsed as HTML. Each card's own rules text comes from `CARDS` in
 * `src/core/cards.ts`, so it cannot drift from the card itself; this file says the rest.
 */

/** A paragraph, or a bulleted list when it is an array of short lines. */
export type RulesBlock = string | readonly string[];

export interface RulesSection {
  title: string;
  body: readonly RulesBlock[];
}

/** One or two sentences under the page heading. */
export const RULES_LEDE =
  "Classic backgammon with a deck of tavern cards at your elbow. Race your checkers home, read the board, and tip the odds with a well-timed play.";

/** Plain backgammon: the board, moving, hitting, bearing off, winning. */
export const BACKGAMMON_RULES: readonly RulesSection[] = [
  {
    title: "The aim",
    body: [
      "White and Black each start with 15 checkers in the standard layout across 24 points. You race in opposite directions toward your own home board, the last six points.",
      "Who moves first is chosen at random. Bear off all 15 checkers first to win: every win counts as one game.",
    ],
  },
  {
    title: "Moving",
    body: [
      "Roll two dice and move forward by each die's number. Each die is a separate move, though one checker may use both.",
      [
        "Empty point: always open.",
        "Your own point: stack as many checkers as you like.",
        "One enemy checker: open, and landing there hits it.",
        "Two or more enemy checkers: blocked.",
      ],
    ],
  },
  {
    title: "Hitting and the bar",
    body: [
      "Landing on a lone enemy checker sends it to the bar. Any checker on the bar must re-enter in your opponent's home board before you move elsewhere.",
      "Each die enters on its matching point there, if that point is open. Until every checker is back in, you can play only dice that bring one in.",
    ],
  },
  {
    title: "Bearing off",
    body: [
      "Once all your remaining checkers stand inside your home board, you may bear them off. A die that matches a checker's distance bears it off; a higher die may bear off your rearmost checker. Bear off all 15 to win.",
    ],
  },
  {
    title: "Doubles and using your dice",
    body: [
      "Rolling doubles plays that number four times instead of two.",
      [
        "Use as many dice as you legally can.",
        "If only one die fits and either could, play the higher one.",
        "Moves that waste a die are withheld: click a checker to see why.",
      ],
    ],
  },
];

/** What this game adds: the turn, the deck and hand, and how card types interact. */
export const ROGUELIKE_RULES: readonly RulesSection[] = [
  {
    title: "Your turn",
    body: [
      "Cards fold straight into your turn, which runs in four steps:",
      [
        "Pick one card from those offered, usually three (skipped when your hand holds five).",
        "Roll the dice.",
        "Move checkers and play cards from your hand, in any order.",
        "End your turn once no checker move is left.",
      ],
    ],
  },
  {
    title: "Your deck and hand",
    body: [
      "Each player brings a shuffled 54-card deck. Stronger cards are rarer: it holds 4 copies of each common card, 3 of each uncommon, 2 of each rare, and 1 of each epic or legendary.",
      "Passed cards go to your discard pile, which reshuffles when the deck runs dry. Your hand holds up to five cards; you see only the backs of your opponent's.",
      [
        "Uncommon: pinstripe stock.",
        "Rare: silver edging.",
        "Epic: violet foil.",
        "Legendary: gold leaf.",
      ],
    ],
  },
  {
    title: "Hexes, wards and traps",
    body: [
      "Curses lay a hex on your opponent that bites on their next roll. Most clear then, though a lasting hex bites every roll until they hit you, roll doubles, or lift it. You cannot cast a hex they already bear.",
      "Standing wards wait in plain sight to block the next hex or rebound it onto the caster. Only a blocking ward stops a rebound: mirrors do not volley. Cleansing wards lift hexes already on you.",
      "Traps sit face down, up to two different kinds: your opponent sees one is set, never which, until it springs.",
    ],
  },
  {
    title: "Table marks",
    body: [
      "Each player's name chip tracks what lies in front of them, using the same colour and glyph printed on each card's type line:",
      [
        "Violet: hexes waiting to bite.",
        "Silver: wards standing guard.",
        "Rust: face-down traps in wait.",
        "Gold: boons aiding your own side.",
      ],
    ],
  },
  {
    title: "Playing cards",
    body: [
      "Most cards are played after rolling, mixed freely with checker moves. Cleansing wards may also be played before you roll while a hex waits on you.",
      'A card that would change nothing stays in your hand, and the game tells you why. If a dice card leaves exactly two matching dice, they play four times as doubles, unless the card says "Never doubles".',
      [
        "Touch screens: tap a card once to read, again to play.",
        "Keyboard: press Space to roll, and E to end your turn.",
      ],
    ],
  },
  {
    title: "Matches and rematches",
    body: [
      "When a game ends, you are offered a rematch. Online it starts once both players accept; in pass and play, one press of Play again is enough. Seats and colours stay, decks are reshuffled, and the first player is random.",
      "Match scores sit beside each name, and character emblems are cosmetic only. If your opponent leaves and stays away, you may claim the win.",
    ],
  },
];

/** Heading over the list of every card. */
export const CARD_LIST_TITLE = "Every card";

/** One short line per card kind, shown above that kind's cards. */
export const KIND_LINES: Record<CardKind, string> = {
  Dice: "Changes the dice you have left to play.",
  Tactic: "Changes the board or protects your checkers.",
  Curse: "Hexes your opponent, biting on their next roll.",
  Ward: "Blocks, rebounds, or lifts hexes cast on you.",
  Trap: "Set face down: springs on what your opponent does.",
  Tempo: "Works on your card picks and hand.",
  Wild: "A gamble that can cut either way.",
};
