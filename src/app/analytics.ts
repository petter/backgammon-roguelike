import { inject } from "@vercel/analytics";

/**
 * A room code is all it takes to join a game, so it never leaves the browser:
 * every invite path is reported as `/g/[code]`.
 */
export function redactRoomCode(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/^\/g\/[^/]+/, "/g/[code]");
  return parsed.toString();
}

/** Starts Vercel Web Analytics. Sends nothing outside a production build. */
export function startAnalytics(): void {
  inject({
    beforeSend: (event) => ({ ...event, url: redactRoomCode(event.url) }),
  });
}
