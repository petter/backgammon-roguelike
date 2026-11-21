import { describe, expect, it } from "vitest";

import { type Box, type CardScene, overlaps, placeCard } from "../src/ui/coachLayout.ts";

/** A card about as tall as the real one: text wraps more as it narrows. */
const measure = (width: number) => Math.round(60 + 52_000 / width);

function cardBox(scene: CardScene): Box {
  const place = placeCard(scene, measure);
  const height = measure(place.width);
  return {
    left: place.at.x,
    right: place.at.x + place.width,
    top: place.at.y,
    bottom: place.at.y + height,
  };
}

const desktop: CardScene = {
  w: 1440,
  h: 900,
  board: { left: 320, right: 1070, top: 165, bottom: 675 },
  room: { left: 345, right: 640, top: 430, bottom: 650 },
  field: { top: 84, bottom: 752 },
  spot: { left: 660, right: 975, top: 395, bottom: 665 },
  tag: { left: 770, right: 860, top: 505, bottom: 530 },
};

describe("placeCard", () => {
  it("puts the card off the board when the window has room", () => {
    const card = cardBox(desktop);
    expect(card.top).toBeGreaterThanOrEqual(desktop.board.bottom);
    expect(card.bottom).toBeLessThanOrEqual(desktop.h);
  });

  it("never covers the spot or the tag on a small phone", () => {
    const phone: CardScene = {
      w: 320,
      h: 568,
      board: { left: 8, right: 312, top: 200, bottom: 400 },
      room: { left: 20, right: 150, top: 300, bottom: 390 },
      field: { top: 120, bottom: 420 },
      spot: { left: 150, right: 280, top: 280, bottom: 395 },
      tag: { left: 175, right: 235, top: 292, bottom: 312 },
    };
    const card = cardBox(phone);
    expect(overlaps(card, phone.spot)).toBe(false);
    expect(overlaps(card, phone.tag as Box)).toBe(false);
    expect(card.top).toBeGreaterThanOrEqual(16);
    expect(card.bottom).toBeLessThanOrEqual(phone.h - 16);
  });

  it("keeps clear of a tag that sits outside the board", () => {
    // Black's BEAR OFF tag, pushed past the far end of the tray, above the board, where the
    // card would otherwise go: the HUD leaves more room above the board than below it.
    const scene: CardScene = {
      w: 390,
      h: 844,
      board: { left: 8, right: 382, top: 276, bottom: 540 },
      room: { left: 20, right: 170, top: 290, bottom: 380 },
      field: { top: 100, bottom: 560 },
      spot: { left: 190, right: 380, top: 280, bottom: 410 },
      tag: null,
    };
    expect(cardBox(scene).bottom).toBeLessThanOrEqual(scene.board.top);
    const tag = { left: 290, right: 374, top: 250, bottom: 272 };
    const card = cardBox({ ...scene, tag });
    expect(card.top).toBeGreaterThanOrEqual(scene.board.bottom);
    expect(overlaps(card, tag)).toBe(false);
  });

  it("uses the side of a short, wide window when nothing else is clear", () => {
    // A phone on its side: the board fills the height, home and its tag the middle.
    const scene: CardScene = {
      w: 667,
      h: 375,
      board: { left: 140, right: 560, top: 40, bottom: 330 },
      room: { left: 160, right: 330, top: 40, bottom: 160 },
      field: { top: 60, bottom: 300 },
      spot: { left: 300, right: 520, top: 50, bottom: 185 },
      tag: { left: 317, right: 404, top: 109, bottom: 139 },
    };
    const card = cardBox(scene);
    expect(overlaps(card, scene.spot)).toBe(false);
    expect(overlaps(card, scene.tag as Box)).toBe(false);
  });
});
