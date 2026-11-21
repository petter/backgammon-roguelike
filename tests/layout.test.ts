import { describe, expect, it } from "vitest";

import { POINT_COUNT } from "../src/core/board.ts";
import { pickAt, slotPosition, TRAY_X } from "../src/render/layout.ts";

describe("layout", () => {
  it("picks back the point a checker stands on", () => {
    for (let index = 0; index < POINT_COUNT; index++) {
      for (const i of [0, 4, 7]) {
        const { x, z } = slotPosition({ kind: "point", index }, i);
        expect(pickAt(x, z)).toEqual({ kind: "point", index });
      }
    }
  });

  it("puts white's home in the near right corner", () => {
    const home = slotPosition({ kind: "point", index: 0 }, 0);
    expect(home.x).toBeGreaterThan(0);
    expect(home.z).toBeGreaterThan(0);
  });

  it("picks the bar, the tray, and nothing outside", () => {
    expect(pickAt(0, 2)).toEqual({ kind: "bar" });
    expect(pickAt(TRAY_X, -3)).toEqual({ kind: "off" });
    expect(pickAt(-9, 0)).toBeNull();
  });
});
