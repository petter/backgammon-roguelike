import type { OnlineCounts } from "../../net/protocol.ts";

/** "12 players online · 2 searching". Both counts include the player reading it. */
export function onlineLine({ online, searching }: OnlineCounts): string {
  return `${online} ${online === 1 ? "player" : "players"} online · ${searching} searching`;
}
