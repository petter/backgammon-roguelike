import { inject } from "@vercel/analytics";
import type { CaptureResult, PostHog, PostHogConfig, Properties } from "posthog-js";

import type { CardId } from "../core/cards.ts";
import type { CharacterId } from "../core/characters.ts";
import type { WinReason } from "../core/game.ts";

/** How a game came about: on one screen, with a friend by code or link, or with a stranger. */
export type GameMode = "local" | "friend" | "matched" | "online";
/** How a guest reached a friend's table: typing the code, or opening the invite link. */
export type JoinVia = "code" | "invite_link";

/**
 * Every product event and what it carries. Never a name, a room code or a chat line: only
 * which choices were made, so no event says who made them.
 */
export interface Events {
  menu_choice: { choice: "seek" | "join" | "host" | "local" | "rules" };
  /** A guest arrived by invite link; `invite_dead` follows if its game is gone or full. */
  invite_opened: Record<string, never>;
  invite_dead: { why: "missing" | "full" };
  room_created: { character: CharacterId };
  room_joined: { via: JoinVia; character: CharacterId };
  room_join_failed: { via: JoinVia; reason: "missing" | "full" | "unreachable" };
  search_started: { character: CharacterId };
  match_found: { waited_s: number };
  search_cancelled: { waited_s: number };
  game_started: { mode: GameMode };
  card_picked: { mode: GameMode; card: CardId; offered: CardId[] };
  card_played: { mode: GameMode; card: CardId };
  /** `outcome` is `local` on one screen, where both sides are the same people. */
  game_finished: {
    mode: GameMode;
    outcome: "won" | "lost" | "local";
    reason: WinReason;
    game: number;
  };
  rematch_started: { mode: GameMode };
  chat_sent: Record<string, never>;
}

/**
 * A room code is all it takes to join a game, so it never leaves the browser:
 * every invite path is reported as `/g/[code]`.
 */
export function redactRoomCode(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/^\/g\/[^/]+/, "/g/[code]");
  return parsed.toString();
}

/** The same for any text that may hold an invite path: a URL, a path or a referrer. */
function redactRoomCodes(text: string): string {
  return text.replaceAll(/\/g\/[^/?#\s]+/g, "/g/[code]");
}

/** Redacts every string in a value, however deeply it sits in arrays and objects. */
function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return redactRoomCodes(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") return scrub(value);
  return value;
}

function scrub(properties: Properties): Properties {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, scrubValue(value)]),
  );
}

/** Strips room codes from every property PostHog would send, including URLs it adds itself. */
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  return {
    ...event,
    properties: scrub(event.properties),
    ...(event.$set && { $set: scrub(event.$set) }),
    ...(event.$set_once && { $set_once: scrub(event.$set_once) }),
  };
}

/**
 * Cookieless and anonymous: nothing is stored in the browser, so each page load is a
 * stranger, and only the events in `Events` (plus page views) are sent. No replays,
 * autocapture, surveys or scripts fetched from PostHog later.
 */
export function posthogConfig(apiHost: string): Partial<PostHogConfig> {
  return {
    api_host: apiHost,
    persistence: "memory",
    person_profiles: "identified_only",
    capture_pageview: true,
    autocapture: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    mask_personal_data_properties: true,
    before_send: scrubEvent,
  };
}

type Queued = [name: string, properties: Properties];

/** Caps what is held while PostHog loads, should it never finish. */
const QUEUE_LIMIT = 100;

let client: PostHog | null = null;
/** Events waiting for PostHog to load; `null` when nothing is to be sent at all. */
let queue: Queued[] | null = null;

interface AnalyticsEnv {
  PROD: boolean;
  VITE_POSTHOG_PROJECT_TOKEN?: string;
  VITE_POSTHOG_HOST?: string;
}

/**
 * Starts Vercel Web Analytics for visits, and PostHog for what players choose. Sends
 * nothing outside a production build. PostHog loads after the game, off its critical path;
 * events tracked meanwhile wait for it.
 */
export async function startAnalytics(env: AnalyticsEnv = import.meta.env): Promise<void> {
  inject({
    beforeSend: (event) => ({ ...event, url: redactRoomCode(event.url) }),
  });
  const token = env.VITE_POSTHOG_PROJECT_TOKEN;
  if (!env.PROD || !token) return;
  queue = [];
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.init(token, posthogConfig(env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com"));
    client = posthog;
    for (const [name, properties] of queue) posthog.capture(name, properties);
  } catch {
    // Blocked or offline: the game goes on without analytics.
  } finally {
    queue = null;
  }
}

/** Reports a product event. Does nothing until `startAnalytics` has been called in production. */
export function track<K extends keyof Events>(name: K, properties: Events[K]): void {
  if (client) client.capture(name, properties);
  else if (queue && queue.length < QUEUE_LIMIT) queue.push([name, properties]);
}

/** Whole seconds since `start`, for how long a wait took. */
export function secondsSince(start: number, now = Date.now()): number {
  return Math.round((now - start) / 1000);
}
