import { describe, expect, it } from "vitest";

import { guidePrefs } from "../src/ui/guidePrefs.ts";

function memory(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe("guidePrefs", () => {
  it("shows the guides until they are turned off, and remembers that", () => {
    const box = memory();
    expect(guidePrefs(() => box).off()).toBe(false);
    guidePrefs(() => box).setOff(true);
    // A new game reads the same storage: still off.
    expect(guidePrefs(() => box).off()).toBe(true);
    guidePrefs(() => box).setOff(false);
    expect(guidePrefs(() => box).off()).toBe(false);
  });

  it("keeps the guides on when storage refuses", () => {
    const refusing = () => {
      throw new Error("blocked");
    };
    expect(guidePrefs(refusing).off()).toBe(false);
    expect(() => guidePrefs(refusing).setOff(true)).not.toThrow();
  });
});
