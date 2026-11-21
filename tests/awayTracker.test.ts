import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAwayTracker } from "../src/app/awayTracker.ts";
import { newGame } from "../src/core/game.ts";
import { viewFor } from "../src/core/view.ts";
import { type OpponentPresence, type ServerMessage } from "../src/net/protocol.ts";
import { type ClientSocket, createRemoteSession } from "../src/net/remoteSession.ts";
import type { OpponentAwayState } from "../src/ui/hud.ts";

class StubSocket implements ClientSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(): void {}
  close(): void {}
  deliver(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function stateMessage(
  version: number,
  phase: "pick" | "over",
  presence: OpponentPresence,
): ServerMessage {
  const base = newGame(7).state;
  const game =
    phase === "over"
      ? { ...base, phase: "over" as const, winner: "white" as const, winReason: "bearOff" as const }
      : base;
  return {
    type: "state",
    version,
    lobby: {
      code: "AAAAA",
      you: "white",
      players: {
        white: { name: "Ada", character: "gambler" },
        black: { name: "Grace", character: "seer" },
      },
    },
    view: viewFor(game, "white"),
    events: [],
    presence,
  };
}

describe("awayTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down to claimable after reloading mid-countdown through remoteSession", () => {
    let now = 1000;
    const banners: Array<OpponentAwayState | null> = [];
    const tracker = createAwayTracker(
      {
        onBanner: (state) => banners.push(state),
        onOnlineChange: () => {},
        onReconnected: () => {},
      },
      () => now,
    );
    const socket = new StubSocket();
    const session = createRemoteSession(
      "AAAAA",
      "tok",
      {
        onStatus: () => {},
        onError: () => {},
        onUpdate: (update) => {
          const active = update.view !== null && update.view.phase !== "over";
          tracker.setGame(active, update.lobby.players.black?.name ?? null);
        },
        onPresence: (presence) => tracker.onPresence(presence),
      },
      () => socket,
    );

    socket.onopen?.();
    // Fresh 30s grace displays 30s (never 31s from the button-enable safety margin).
    socket.deliver(stateMessage(2, "pick", { online: false, claimInMs: 30_000 }));
    expect(banners.at(-1)).toMatchObject({ name: "Grace", secondsLeft: 30, claiming: false });

    // Reload mid-countdown with 2 seconds left: displays 2s, stays at 1s during the 150ms margin.
    socket.deliver(stateMessage(3, "pick", { online: false, claimInMs: 2000 }));
    expect(banners.at(-1)).toMatchObject({ name: "Grace", secondsLeft: 2, claiming: false });
    now += 2050;
    vi.advanceTimersByTime(2050);
    expect(banners.at(-1)).toMatchObject({ name: "Grace", secondsLeft: 1, claiming: false });
    expect(tracker.beginClaim(false)).toBe(false);

    // Advance past the 150ms button margin: banner reaches 0s (claimable) and stops ticking.
    now += 250;
    vi.advanceTimersByTime(250);
    expect(banners.at(-1)).toMatchObject({ name: "Grace", secondsLeft: 0, claiming: false });
    expect(tracker.beginClaim(false)).toBe(true);
    expect(banners.at(-1)?.claiming).toBe(true);

    // A refused claim re-enables the button.
    tracker.onClaimError();
    expect(banners.at(-1)?.claiming).toBe(false);

    tracker.stop();
    session.close();
  });

  it("restarts the countdown when a rematch snapshot replaces a finished game with an away opponent", () => {
    let now = 5000;
    const banners: Array<OpponentAwayState | null> = [];
    const tracker = createAwayTracker(
      {
        onBanner: (state) => banners.push(state),
        onOnlineChange: () => {},
        onReconnected: () => {},
      },
      () => now,
    );
    const socket = new StubSocket();
    const session = createRemoteSession(
      "AAAAA",
      "tok",
      {
        onStatus: () => {},
        onError: () => {},
        onUpdate: (update) => {
          const active = update.view !== null && update.view.phase !== "over";
          tracker.setGame(active, update.lobby.players.black?.name ?? null);
        },
        onPresence: (presence) => tracker.onPresence(presence),
      },
      () => socket,
    );

    socket.onopen?.();
    // Game 1 is over with Grace away.
    socket.deliver(stateMessage(4, "over", { online: false, claimInMs: null }));
    expect(banners.at(-1)).toBeNull();

    // Game 2 starts via rematch while Grace is still away (3s left).
    socket.deliver(stateMessage(5, "pick", { online: false, claimInMs: 3000 }));
    expect(banners.at(-1)?.secondsLeft).toBeGreaterThan(0);

    now += 3250;
    vi.advanceTimersByTime(3250);
    expect(banners.at(-1)).toMatchObject({ name: "Grace", secondsLeft: 0 });
    tracker.stop();
    session.close();
  });

  it("also reconciles the timer if onPresence arrives before setGame installs the active view", () => {
    let now = 0;
    const banners: Array<OpponentAwayState | null> = [];
    const reconnected: string[] = [];
    const tracker = createAwayTracker(
      {
        onBanner: (state) => banners.push(state),
        onOnlineChange: () => {},
        onReconnected: (name) => reconnected.push(name),
      },
      () => now,
    );

    tracker.onPresence({ online: false, claimInMs: 1000 });
    expect(banners.at(-1)).toBeNull();
    tracker.setGame(true, "Grace");
    expect(banners.at(-1)?.secondsLeft).toBe(1);

    now += 1250;
    vi.advanceTimersByTime(1250);
    expect(banners.at(-1)?.secondsLeft).toBe(0);

    // Opponent reconnects before claim: clears banner and fires reconnect notice.
    tracker.onPresence({ online: true, claimInMs: null });
    expect(banners.at(-1)).toBeNull();
    expect(reconnected).toEqual(["Grace"]);
    tracker.stop();
  });

  it("clears stale claim UI silently without firing a reconnect notice when presence becomes unavailable", () => {
    const now = 0;
    const banners: Array<OpponentAwayState | null> = [];
    const onlineChanges: boolean[] = [];
    const reconnected: string[] = [];
    const tracker = createAwayTracker(
      {
        onBanner: (state) => banners.push(state),
        onOnlineChange: (online) => onlineChanges.push(online),
        onReconnected: (name) => reconnected.push(name),
      },
      () => now,
    );

    tracker.setGame(true, "Grace");
    tracker.onPresence({ online: false, claimInMs: 0 });
    expect(banners.at(-1)).toMatchObject({ name: "Grace", secondsLeft: 0 });

    // Handover to an older server without presence support sends `null`.
    tracker.onPresence(null);
    expect(banners.at(-1)).toBeNull();
    expect(tracker.isOnline()).toBe(true);
    expect(tracker.beginClaim(false)).toBe(false);
    expect(onlineChanges).toEqual([false, true]);
    expect(reconnected).toEqual([]);
    tracker.stop();
  });
});
