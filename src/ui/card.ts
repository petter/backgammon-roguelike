import { CARD_IDS, CARDS, type CardId, copiesOf, RARITIES } from "../core/cards.ts";
import { cardArt } from "./cardArt.ts";

function part(tag: string, className: string, content = ""): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

/**
 * A card as a button, laid out like a printed trading card: a paper border around a frame
 * in the rarity's colour, holding a name plate with the copy count, an illustration, a type
 * line with the rarity gem, the rules text and a collector line, under a sheet of gloss.
 */
export function createCard(
  card: CardId,
  onClick?: () => void,
  /** Shown big enough to study, as when picking: larger, with the collector line. */
  large = false,
): HTMLButtonElement {
  const { name, kind, rarity, text } = CARDS[card];
  const copies = copiesOf(card);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card rarity-${rarity}${large ? " card-large" : ""}`;
  button.title = `${RARITIES[rarity].name}: ${copies} in each deck`;

  const art = part("span", "card-art");
  // Fixed markup from our own source, not user input.
  art.innerHTML = cardArt(card);
  // A sheet of foil over the picture; only the rarest cards print anything on it.
  art.append(part("span", "card-foil"));

  const plate = part("span", "card-name");
  plate.append(part("span", "", name), part("span", "card-copies", `×${copies}`));

  const type = part("span", "card-type");
  const rarityLabel = part("span", "card-rarity");
  rarityLabel.append(part("span", "card-gem"), RARITIES[rarity].name);
  type.append(part("span", "card-kind", kind), rarityLabel);

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
