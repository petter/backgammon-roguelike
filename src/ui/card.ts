import { CARD_IDS, CARDS, type CardId, RARITIES } from "../core/cards.ts";
import { cardArt } from "./cardArt.ts";
import { glyph, KIND_GLYPH } from "./glyphs.ts";

/** Names longer than this many letters are set smaller to fit the name plate. */
const LONG_NAME = 14;

function part(tag: string, className: string, content = ""): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

/**
 * A card as a button, laid out like a printed trading card: a paper border around a frame
 * in the rarity's colour, holding a name plate, an illustration, a type
 * line with the rarity gem, the rules text and a collector line, under a sheet of gloss.
 */
export function createCard(
  card: CardId,
  onClick?: () => void,
  /** Shown big enough to study, as when picking: larger, with the collector line. */
  large = false,
): HTMLButtonElement {
  const { name, kind, rarity, text } = CARDS[card];
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card rarity-${rarity}${large ? " card-large" : ""}`;

  const art = part("span", "card-art");
  // Fixed markup from our own source, not user input.
  art.innerHTML = cardArt(card);
  // A sheet of foil over the picture; only the rarest cards print anything on it.
  art.append(part("span", "card-foil"));

  const plate = part("span", "card-name", name);
  // A long name is set a size smaller, so it stays on one line inside the plate.
  if (name.length > LONG_NAME) plate.classList.add("card-name-long");

  const type = part("span", "card-type");
  const rarityLabel = part("span", "card-rarity");
  rarityLabel.append(part("span", "card-gem"), RARITIES[rarity].name);
  const kindLabel = part("span", `card-kind kind-${kind.toLowerCase()}`);
  kindLabel.append(glyph(KIND_GLYPH[kind], "card-kind-glyph"), kind);
  type.append(kindLabel, rarityLabel);

  const foot = part("span", "card-foot");
  const number = `${CARD_IDS.indexOf(card) + 1}/${CARD_IDS.length}`;
  foot.append(part("span", "", "Core set"), part("span", "", number));

  const frame = part("span", "card-frame");
  frame.append(plate, art, type, part("span", "card-text", text), foot);
  button.append(frame, part("span", "card-gloss"));
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

/**
 * Arranges a card as one of `count` held in a fan: the outer cards lean away from the
 * middle and sit a little lower. The hand's styles read the two properties set here.
 */
export function fanCard(card: HTMLElement, index: number, count: number): void {
  const offset = index - (count - 1) / 2;
  card.style.setProperty("--tilt", `${offset * 3.2}deg`);
  card.style.setProperty("--drop", `${offset * offset * 2.2}px`);
}
