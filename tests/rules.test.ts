import { describe, expect, it } from "vitest";

import { CARD_IDS, CARDS } from "../src/core/cards.ts";
import { KIND_ORDER } from "../src/ui/lobby/rules.ts";
import {
  BACKGAMMON_RULES,
  CARD_LIST_TITLE,
  KIND_LINES,
  ROGUELIKE_RULES,
  RULES_LEDE,
} from "../src/ui/lobby/rulesCopy.ts";

const allText = [
  RULES_LEDE,
  CARD_LIST_TITLE,
  ...Object.values(KIND_LINES),
  ...[...BACKGAMMON_RULES, ...ROGUELIKE_RULES].flatMap(({ title, body }) =>
    [title].concat(body.flat()),
  ),
];

describe("How to play", () => {
  it("lists every kind of card a deck holds", () => {
    for (const id of CARD_IDS) expect(KIND_ORDER).toContain(CARDS[id].kind);
  });

  it("has every line written", () => {
    expect(BACKGAMMON_RULES.length).toBeGreaterThan(0);
    expect(ROGUELIKE_RULES.length).toBeGreaterThan(0);
    for (const line of allText) {
      expect(line.trim()).not.toBe("");
      expect(line).not.toMatch(/TODO/);
    }
  });
});
