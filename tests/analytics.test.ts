import type { CaptureResult } from "posthog-js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { posthogConfig, redactRoomCode, scrubEvent, secondsSince } from "../src/app/analytics.ts";

// Hoisted above the imports by vitest.
vi.mock("@vercel/analytics", () => ({ inject: vi.fn<() => void>() }));
const posthog = vi.hoisted(() => ({
  init: vi.fn<(token: string, config: unknown) => void>(),
  capture: vi.fn<(name: string, properties: unknown) => void>(),
}));
vi.mock("posthog-js", () => ({ default: posthog }));

const PROD = {
  PROD: true,
  VITE_POSTHOG_PROJECT_TOKEN: "phc_test",
  VITE_POSTHOG_HOST: "https://ph",
};

/** A fresh copy of the module, since it keeps whether PostHog has loaded. */
async function fresh() {
  vi.resetModules();
  return import("../src/app/analytics.ts");
}

beforeEach(() => {
  posthog.init.mockClear();
  posthog.capture.mockClear();
});
afterEach(() => vi.resetModules());

test("an invite path is reported without its room code", () => {
  expect(redactRoomCode("https://example.com/g/abcde")).toBe("https://example.com/g/[code]");
  expect(redactRoomCode("https://example.com/g/abcde/?seed=7")).toBe(
    "https://example.com/g/[code]/?seed=7",
  );
});

test("other paths are reported as they are", () => {
  expect(redactRoomCode("https://example.com/?seed=7")).toBe("https://example.com/?seed=7");
});

test("no room code reaches PostHog, in any property it adds", () => {
  const event = {
    uuid: "u",
    event: "$pageview",
    properties: {
      $current_url: "https://example.com/g/abcde?seed=7",
      $pathname: "/g/abcde",
      $referrer: "https://example.com/g/fghij",
      game: 2,
      nested: { paths: ["/g/abcde", { url: "https://example.com/g/abcde" }] },
    },
    $set_once: { $initial_pathname: "/g/abcde" },
  } as CaptureResult;
  expect(scrubEvent(event)).toEqual({
    uuid: "u",
    event: "$pageview",
    properties: {
      $current_url: "https://example.com/g/[code]?seed=7",
      $pathname: "/g/[code]",
      $referrer: "https://example.com/g/[code]",
      game: 2,
      nested: { paths: ["/g/[code]", { url: "https://example.com/g/[code]" }] },
    },
    $set_once: { $initial_pathname: "/g/[code]" },
  });
});

test("PostHog keeps nothing in the browser and captures only what is asked", () => {
  expect(posthogConfig("https://ph")).toMatchObject({
    api_host: "https://ph",
    persistence: "memory",
    person_profiles: "identified_only",
    autocapture: false,
    disable_session_recording: true,
    disable_external_dependency_loading: true,
    before_send: scrubEvent,
  });
});

test("events tracked while PostHog loads are sent once it has", async () => {
  const analytics = await fresh();
  const started = analytics.startAnalytics(PROD);
  analytics.track("menu_choice", { choice: "seek" });
  expect(posthog.capture).not.toHaveBeenCalled();
  await started;
  analytics.track("chat_sent", {});
  expect(posthog.init).toHaveBeenCalledWith(
    "phc_test",
    expect.objectContaining({ api_host: "https://ph" }),
  );
  expect(posthog.capture.mock.calls).toEqual([
    ["menu_choice", { choice: "seek" }],
    ["chat_sent", {}],
  ]);
});

test("nothing is sent outside production, or without a project token", async () => {
  for (const env of [{ ...PROD, PROD: false }, { PROD: true }]) {
    const analytics = await fresh();
    await analytics.startAnalytics(env);
    analytics.track("menu_choice", { choice: "local" });
  }
  expect(posthog.init).not.toHaveBeenCalled();
  expect(posthog.capture).not.toHaveBeenCalled();
});

test("waits are reported in whole seconds", () => {
  expect(secondsSince(1000, 13_400)).toBe(12);
});
