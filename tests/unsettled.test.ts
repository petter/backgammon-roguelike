import { describe, expect, it } from "vitest";

import { seatMemory } from "../src/net/seatStorage.ts";
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

  it("isolates new presence-aware tickets from legacy bundles while still settling legacy tickets", () => {
    const storage = tabStorage();
    const memory = ticketMemory(() => storage);
    memory.set("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
    // A pre-deployment bundle only reads `unsettled-ticket`, so it cannot settle this ticket
    // and enter a presence-marked seat over legacy `/ws`.
    expect(storage.getItem("unsettled-ticket")).toBeNull();
    expect(memory.get()).toBe("1b4e28ba-2fa1-11d2-883f-0016d3cca427");

    // A ticket persisted by a pre-deployment bundle still settles after upgrading to the new bundle.
    memory.clear();
    storage.setItem("unsettled-ticket", "2b4e28ba-2fa1-11d2-883f-0016d3cca427");
    expect(memory.get()).toBe("2b4e28ba-2fa1-11d2-883f-0016d3cca427");
    memory.clear("2b4e28ba-2fa1-11d2-883f-0016d3cca427");
    expect(storage.getItem("unsettled-ticket")).toBeNull();
  });

  it("clears only the settled ticket when both v2 and legacy tickets are pending", () => {
    const storage = tabStorage();
    const memory = ticketMemory(() => storage);
    const v2 = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
    const legacy = "2b4e28ba-2fa1-11d2-883f-0016d3cca427";
    storage.setItem("unsettled-ticket", legacy);
    memory.set(v2);

    // Settling the v2 ticket first must preserve the distinct legacy ticket so it settles next.
    expect(memory.get()).toBe(v2);
    memory.clear(v2);
    expect(memory.get()).toBe(legacy);
    memory.clear(legacy);
    expect(memory.get()).toBeNull();

    // A malformed v2 entry must not mask a valid legacy ticket waiting to be settled.
    storage.setItem("unsettled-ticket:v2", "../../bad");
    storage.setItem("unsettled-ticket", legacy);
    expect(memory.get()).toBe(legacy);
  });
});

describe("seatMemory", () => {
  it("prevents a pre-deployment bundle from resuming a presence-marked seat while upgrading legacy seats", () => {
    const storage = tabStorage();
    const seats = seatMemory(() => storage);
    // Simulate a leftover legacy token for the same code, then save a new marked seat.
    storage.setItem("seat:ABCDE", "old-token");
    seats.set("ABCDE", "marked-token");

    // Pre-deployment client reads `seat:ABCDE` and must NOT find the marked seat's token.
    expect(storage.getItem("seat:ABCDE")).toBeNull();
    // Current client reloads and resumes the marked seat over `/ws2`.
    expect(seatMemory(() => storage).get("ABCDE")).toBe("marked-token");

    // Legacy seat saved before deploy still resumes when the tab upgrades to the new client.
    storage.setItem("seat:OLD01", "legacy-token");
    expect(seats.get("OLD01")).toBe("legacy-token");

    seats.forget("ABCDE");
    seats.forget("OLD01");
    expect(seats.get("ABCDE")).toBeNull();
    expect(seats.get("OLD01")).toBeNull();
  });
});
