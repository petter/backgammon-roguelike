import { describe, expect, it } from "vitest";

import type { ServerMessage } from "../src/net/protocol.ts";
import { awaitMatch, cancelMatch, FRESH_MS, seekMatch } from "../src/server/match.ts";
import { createMemoryStore } from "../src/server/memoryStore.ts";
import { openConnection, RoomError } from "../src/server/room.ts";
import type { GameStore } from "../src/server/store.ts";

/** A clock the test moves by hand, shared by the store and the matchmaker. */
function clock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

function setup() {
  const time = clock();
  const store = createMemoryStore(undefined, time.now);
  // Held requests answer at once, so a test never waits on a real timer.
  const options = { now: time.now, holdMs: 0, tickMs: 1 };
  return { time, store, options };
}

async function seatedAs(store: GameStore, code: string, token: string) {
  const inbox: ServerMessage[] = [];
  const connection = await openConnection(store, code, token, (m) => inbox.push(m));
  connection.close();
  const state = inbox.find((m) => m.type === "state");
  if (state?.type !== "state") throw new Error("No state");
  return state;
}

describe("matchmaking", () => {
  it("leaves the first seeker waiting and matches the second with them at once", async () => {
    const { time, store, options } = setup();
    const ada = await seekMatch(store, "Ada", "seer", options);
    expect(ada.seat).toBeNull();
    time.advance(500);
    const grace = await seekMatch(store, "Grace", "corsair", options);
    expect(grace.seat).not.toBeNull();
    const waited = await awaitMatch(store, ada.ticket, options);
    expect(waited.seat?.code).toBe(grace.seat?.code);
    expect(waited.seat?.token).not.toBe(grace.seat?.token);

    // A started game, with whoever waited longer as white.
    const code = grace.seat?.code ?? "";
    const white = await seatedAs(store, code, waited.seat?.token ?? "");
    expect(white.lobby.you).toBe("white");
    expect(white.lobby.players).toEqual({
      white: { name: "Ada", character: "seer" },
      black: { name: "Grace", character: "corsair" },
    });
    expect(white.view).not.toBeNull();
    expect((await seatedAs(store, code, grace.seat?.token ?? "")).lobby.you).toBe("black");
  });

  it("matches the longest waiting seeker first and pairs nobody twice", async () => {
    const { time, store, options } = setup();
    const first = await seekMatch(store, "First", undefined, options);
    time.advance(100);
    const second = await seekMatch(store, "Second", undefined, options);
    time.advance(100);
    const third = await seekMatch(store, "Third", undefined, options);
    expect(second.seat).not.toBeNull();
    expect(third.seat).toBeNull();
    expect((await awaitMatch(store, first.ticket, options)).seat?.code).toBe(second.seat?.code);
    expect((await awaitMatch(store, third.ticket, options)).seat).toBeNull();
  });

  it("names a blank seeker Guest and keeps names clean", async () => {
    const { time, store, options } = setup();
    const a = await seekMatch(store, "   ", undefined, options);
    time.advance(1);
    const b = await seekMatch(store, `  Ada   ${"x".repeat(50)}`, "nonsense", options);
    const state = await seatedAs(store, b.seat?.code ?? "", b.seat?.token ?? "");
    expect(state.lobby.players.white).toEqual({ name: "Guest", character: "gambler" });
    expect(state.lobby.players.black?.name).toHaveLength(20);
    expect(a.seat).toBeNull();
  });

  it("never matches a seeker who has stopped asking, and drops them", async () => {
    const { time, store, options } = setup();
    const quiet = await seekMatch(store, "Quiet", undefined, options);
    time.advance(FRESH_MS + 1);
    const late = await seekMatch(store, "Late", undefined, options);
    expect(late.seat).toBeNull();
    await expect(awaitMatch(store, quiet.ticket, options)).rejects.toThrow(RoomError);
    time.advance(1);
    // The newcomer waits for the next seeker instead.
    const next = await seekMatch(store, "Next", undefined, options);
    expect((await awaitMatch(store, late.ticket, options)).seat?.code).toBe(next.seat?.code);
  });

  it("keeps a seeker present for as long as they keep asking", async () => {
    const { time, store, options } = setup();
    const patient = await seekMatch(store, "Patient", undefined, options);
    for (let i = 0; i < 5; i++) {
      time.advance(FRESH_MS - 1);
      expect((await awaitMatch(store, patient.ticket, options)).seat).toBeNull();
    }
    const newcomer = await seekMatch(store, "Newcomer", undefined, options);
    expect(newcomer.seat).not.toBeNull();
  });

  it("holds a wait open until a match arrives", async () => {
    const store = createMemoryStore();
    const ada = await seekMatch(store, "Ada");
    const waiting = awaitMatch(store, ada.ticket, { holdMs: 5000, tickMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const grace = await seekMatch(store, "Grace");
    expect((await waiting).seat?.code).toBe(grace.seat?.code);
  });

  it("answers a held wait early once its client hangs up", async () => {
    const store = createMemoryStore();
    const ada = await seekMatch(store, "Ada");
    const hangUp = new AbortController();
    const started = Date.now();
    const waiting = awaitMatch(store, ada.ticket, { holdMs: 60_000, signal: hangUp.signal });
    setTimeout(() => hangUp.abort(), 20);
    expect((await waiting).seat).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("stops looking on cancel, but still hands over a seat found just before", async () => {
    const { time, store, options } = setup();
    const ada = await seekMatch(store, "Ada", undefined, options);
    expect(await cancelMatch(store, ada.ticket)).toEqual({ ticket: ada.ticket, seat: null });
    await expect(awaitMatch(store, ada.ticket, options)).rejects.toThrow("No longer looking");
    expect((await seekMatch(store, "Grace", undefined, options)).seat).toBeNull();

    time.advance(1);
    const bob = await seekMatch(store, "Bob", undefined, options);
    const matched = await cancelMatch(store, bob.ticket);
    expect(matched.seat).not.toBeNull();
    // Cancelling again is harmless.
    expect((await cancelMatch(store, bob.ticket)).seat).toEqual(matched.seat);
  });

  it("builds one room when two seekers are waiting for each other", async () => {
    const { time, store, options } = setup();
    let created = 0;
    const counting: GameStore = {
      ...store,
      create: async (room) => {
        created++;
        return store.create(room);
      },
    };
    // Two seekers who joined in the same instant, before either looked for the other.
    await store.addSeeker({
      id: "a",
      name: "A",
      character: "gambler",
      since: time.now(),
      seen: time.now(),
    });
    await store.addSeeker({
      id: "b",
      name: "B",
      character: "gambler",
      since: time.now(),
      seen: time.now(),
    });
    const [a, b] = await Promise.all([
      awaitMatch(counting, "a", options),
      awaitMatch(counting, "b", options),
    ]);
    const again = await awaitMatch(counting, "a", options);
    expect(created).toBe(1);
    expect(again.seat?.code).toBe(a.seat?.code ?? b.seat?.code);
  });

  it("recovers when another seeker took the partner first", async () => {
    const { time, store, options } = setup();
    const ada = await seekMatch(store, "Ada", undefined, options);
    time.advance(10);
    await store.addSeeker({
      id: "b",
      name: "B",
      character: "gambler",
      since: time.now(),
      seen: time.now(),
    });
    await store.addSeeker({
      id: "c",
      name: "C",
      character: "gambler",
      since: time.now() + 1,
      seen: time.now(),
    });
    // B and C both go for Ada at once; one wins, the other keeps waiting.
    const [b, c] = await Promise.all([
      awaitMatch(store, "b", options),
      awaitMatch(store, "c", options),
    ]);
    const seats = [b.seat, c.seat].filter(Boolean);
    expect(seats).toHaveLength(1);
    expect((await awaitMatch(store, ada.ticket, options)).seat?.code).toBe(seats[0]?.code);
  });
});
