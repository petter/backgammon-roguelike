import {
  CARD_IDS,
  CARDS,
  type CardId,
  type CardKind,
  copiesOf,
  RARITIES,
} from "../../core/cards.ts";
import { glyph, KIND_GLYPH } from "../glyphs.ts";
import {
  BACKGAMMON_RULES,
  CARD_LIST_TITLE,
  KIND_LINES,
  ROGUELIKE_RULES,
  RULES_LEDE,
  type RulesSection,
} from "./rulesCopy.ts";

import "./rules.css";

/** The order kinds are listed in: what you do to your dice and board, then to them. */
export const KIND_ORDER: readonly CardKind[] = [
  "Dice",
  "Tactic",
  "Curse",
  "Ward",
  "Trap",
  "Tempo",
  "Wild",
];
const RARITY_ORDER = Object.keys(RARITIES);

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function section({ title, body }: RulesSection): HTMLElement {
  const box = node("section", "rules-section");
  box.append(node("h4", "rules-section-title", title));
  for (const block of body) {
    if (typeof block === "string") {
      box.append(node("p", "", block));
      continue;
    }
    const list = node("ul");
    for (const line of block) list.append(node("li", "", line));
    box.append(list);
  }
  return box;
}

function part(title: string, sections: readonly RulesSection[]): HTMLElement {
  const box = node("div", "rules-part");
  box.append(node("h3", "rules-part-title", title), ...sections.map(section));
  return box;
}

function cardRow(card: CardId): HTMLElement {
  const { name, rarity, text } = CARDS[card];
  const row = node("li", "rules-card");
  const head = node("div", "rules-card-head");
  const label = node("span", "rules-rarity");
  // The gem alone carries the rarity class: it also redefines the lobby's metal tokens.
  label.append(node("span", `rules-gem rarity-${rarity}`), RARITIES[rarity].name);
  const copies = copiesOf(card);
  head.append(
    node("b", "rules-card-name", name),
    label,
    node("span", "rules-copies", `${copies} ${copies === 1 ? "copy" : "copies"}`),
  );
  row.append(head, node("p", "rules-card-text", text));
  return row;
}

/** Every card, grouped by kind and ordered from common to legendary within it. */
function cardList(): HTMLElement {
  const box = node("div", "rules-part rules-cards");
  box.append(node("h3", "rules-part-title", CARD_LIST_TITLE));
  for (const kind of KIND_ORDER) {
    const cards = CARD_IDS.filter((id) => CARDS[id].kind === kind).toSorted(
      (a, b) => RARITY_ORDER.indexOf(CARDS[a].rarity) - RARITY_ORDER.indexOf(CARDS[b].rarity),
    );
    if (cards.length === 0) continue;
    const group = node("section", `rules-kind kind-${kind.toLowerCase()}`);
    const heading = node("h4", "rules-kind-title");
    heading.append(glyph(KIND_GLYPH[kind], "card-kind-glyph"), kind);
    const list = node("ul", "rules-card-list");
    list.append(...cards.map(cardRow));
    group.append(heading, node("p", "rules-kind-line", KIND_LINES[kind]), list);
    box.append(group);
  }
  return box;
}

/**
 * The "How to play" page: plain backgammon, what the cards add, then every card. Built
 * once; the lobby shows and hides it like its other views.
 */
export function rulesPage(onBack: () => void): { element: HTMLElement; back: HTMLElement } {
  const page = node("article", "plaque rules");
  page.setAttribute("aria-labelledby", "rules-title");
  const back = node("button", "link back", "‹ Back");
  back.type = "button";
  const header = node("header");
  const title = node("h2", "lobby-heading", "How to play");
  title.id = "rules-title";
  header.append(title, node("p", "lede", RULES_LEDE));
  const done = node("button", "primary rules-done", "Back to the menu");
  done.type = "button";
  page.append(
    back,
    header,
    part("Backgammon", BACKGAMMON_RULES),
    part("The cards", ROGUELIKE_RULES),
    cardList(),
    done,
  );
  back.addEventListener("click", onBack);
  done.addEventListener("click", onBack);
  return { element: page, back };
}
