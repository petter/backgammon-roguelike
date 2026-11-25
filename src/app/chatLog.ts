import { CHAT_KEEP, type ChatMessage } from "../net/protocol.ts";

/**
 * Lines merged into a log: each id once, in id order, only the newest `keep`. Also says
 * which of `incoming` were new, so a line that comes round again is not announced twice.
 */
export function mergeChat(
  log: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
  keep = CHAT_KEEP,
): { log: ChatMessage[]; added: ChatMessage[] } {
  const known = new Set(log.map((line) => line.id));
  const added: ChatMessage[] = [];
  for (const line of incoming) {
    if (known.has(line.id)) continue;
    known.add(line.id);
    added.push(line);
  }
  if (added.length === 0) return { log: [...log], added };
  const merged = [...log, ...added].toSorted((a, b) => a.id - b.id).slice(-keep);
  const oldest = merged[0]?.id ?? 0;
  return { log: merged, added: added.filter((line) => line.id >= oldest) };
}
