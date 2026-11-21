import { describe, expect, it } from "vitest";

import { ticketMemory } from "../src/net/unsettled.ts";

/** A stand-in for one tab's sessionStorage, which outlives a reload of that tab. */
function tabStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe("ticketMemory", () => {
  it("keeps an unsettled ticket across a reload until it is cleared", () => {
    const storage = tabStorage();
    const before = ticketMemory(() => storage);
    expect(before.get()).toBeNull();
    before.set("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
    // The page reloads: a new memory over the same tab's storage.
    const after = ticketMemory(() => storage);
    expect(after.get()).toBe("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
    after.clear();
    expect(ticketMemory(() => storage).get()).toBeNull();
  });

  it("ignores anything stored that is not a ticket", () => {
    const storage = tabStorage();
    storage.setItem("unsettled-ticket", "../../api/rooms");
    expect(ticketMemory(() => storage).get()).toBeNull();
  });

  it("treats storage that is unavailable as empty", () => {
    const memory = ticketMemory(() => {
      throw new Error("blocked");
    });
    memory.set("abc");
    memory.clear();
    expect(memory.get()).toBeNull();
  });
});
