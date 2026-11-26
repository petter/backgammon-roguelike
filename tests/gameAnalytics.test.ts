import { beforeEach, expect, test, vi } from "vitest";

import { track } from "../src/app/analytics.ts";
import { gameReporter } from "../src/app/gameAnalytics.ts";
import type { GameEvent } from "../src/core/game.ts";
import { newGame } from "../src/core/game.ts";
import { type PlayerView, viewFor } from "../src/core/view.ts";
import type { SessionUpdate } from "../src/net/session.ts";
import { game } from "./helpers.ts";

vi.mock("../src/app/analytics.ts", () => ({ track: vi.fn<typeof track>() }));
const tracked = vi.mocked(track);

const lobby = { code: "abcde", you: "white", players: { white: null, black: null } } as const;
const fresh = viewFor(newGame(1).state, "white");
/** A game under way: a move has been made, so it is no longer the opening position. */
const underWay = viewFor(game({ phase: "roll" }), "white");

const update = (view: PlayerView | null, events: GameEvent[] = []): SessionUpdate => ({
  lobby,
  view,
  events,
});

beforeEach(() => tracked.mockClear());

test("a fresh game is reported as started once; a return to one under way is not", () => {
  const report = gameReporter("matched");
  report(update(null));
  report(update(fresh));
  report(update(fresh));
  expect(tracked.mock.calls).toEqual([["game_started", { mode: "matched" }]]);

  tracked.mockClear();
  gameReporter("online")(update(underWay));
  expect(tracked).not.toHaveBeenCalled();
});

test("online, only this seat's cards are reported, with what was on offer", () => {
  const report = gameReporter("friend");
  report(update(underWay));
  report(
    update(underWay, [
      { type: "cardsOffered", player: "white", cards: ["shield", "charm", "quake"] },
      { type: "cardPicked", player: "white", card: "charm" },
      { type: "cardPicked", player: "black", card: null },
      { type: "cardPlayed", player: "white", card: "shield" },
      { type: "cardPlayed", player: "black", card: "quake" },
    ]),
  );
  expect(tracked.mock.calls).toEqual([
    ["card_picked", { mode: "friend", card: "charm", offered: ["shield", "charm", "quake"] }],
    ["card_played", { mode: "friend", card: "shield" }],
  ]);
});

test("on one screen, both sides' cards are reported", () => {
  const report = gameReporter("local");
  report(update(underWay));
  report(
    update(underWay, [
      { type: "cardPicked", player: "white", card: "charm" },
      { type: "cardPicked", player: "black", card: "quake" },
    ]),
  );
  expect(tracked.mock.calls.map(([, props]) => props)).toEqual([
    { mode: "local", card: "charm", offered: [] },
    { mode: "local", card: "quake", offered: [] },
  ]);
});

test("a finished game says who won from this seat, and a rematch is reported", () => {
  const over = viewFor(
    game({ phase: "over", winner: "black", winReason: "bearOff", wins: { white: 0, black: 1 } }),
    "white",
  );
  const report = gameReporter("matched");
  report(update(underWay));
  report(update(over, [{ type: "gameWon", winner: "black" }]));
  report(update(fresh, [{ type: "gameStarted", first: "white" }]));
  expect(tracked.mock.calls).toEqual([
    ["game_finished", { mode: "matched", outcome: "lost", reason: "bearOff", game: 1 }],
    ["rematch_started", { mode: "matched" }],
  ]);
});

test("a pick after a reload reports the offer the snapshot showed", () => {
  const picking = viewFor(
    game({
      phase: "pick",
      cards: { ...game().cards, white: { ...game().cards.white, offer: ["shield", "quake"] } },
    }),
    "white",
  );
  const report = gameReporter("matched");
  report(update(picking));
  report(update(underWay, [{ type: "cardPicked", player: "white", card: "quake" }]));
  expect(tracked.mock.calls).toEqual([
    ["card_picked", { mode: "matched", card: "quake", offered: ["shield", "quake"] }],
  ]);
});
