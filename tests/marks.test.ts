import { describe, expect, it } from "vitest";

import { viewFor } from "../src/core/view.ts";
import { marksFor } from "../src/ui/marks.ts";
import { game } from "./helpers.ts";

describe("marksFor", () => {
  const state = game({
    hexes: { white: ["leadWeight"], black: [] },
    wards: { white: [], black: ["mirror"] },
    traps: { white: ["counterpunch"], black: ["looseBoard"] },
  });

  it("lays a hex face up in front of the player it waits on", () => {
    const view = viewFor(state, "black");
    expect(marksFor(view, "white")).toContainEqual(
      expect.objectContaining({ kind: "hex", card: "leadWeight", faceDown: false }),
    );
    expect(marksFor(view, "black")).toContainEqual(
      expect.objectContaining({ kind: "ward", card: "mirror", faceDown: false }),
    );
  });

  it("shows your own trap to you, and the opponent's only as a face-down card", () => {
    const view = viewFor(state, "white");
    expect(marksFor(view, "white")).toContainEqual(
      expect.objectContaining({ kind: "trap", card: "counterpunch", faceDown: true }),
    );
    const theirs = marksFor(view, "black").filter((mark) => mark.kind === "trap");
    expect(theirs).toEqual([
      expect.objectContaining({ card: null, faceDown: true, label: "A trap" }),
    ]);
  });
});
