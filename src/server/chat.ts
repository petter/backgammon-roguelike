import type { Player } from "../core/board.ts";
import { CHAT_KEEP, type ChatMessage, cleanChat, type ServerMessage } from "../net/protocol.ts";
import type { GameStore } from "./store.ts";

/** How many lines a seat may send in a burst before it has to slow down. */
export const CHAT_BURST = 5;
/** How long it takes to earn back one line of the burst. */
export const CHAT_REFILL_MS = 2000;

export interface ChatOptions {
  /** How often to look for lines this connection was never told about. */
  resyncMs?: number;
  /** Clock for the time stamped on each line and for the rate limit. */
  now?: () => number;
}

/** One seat's chat on one connection. */
export interface ChatLink {
  /** Says a line from this seat. Blank lines are dropped; too many too fast are refused. */
  say: (text: string) => Promise<void>;
  close: () => void;
}

/**
 * Opens a seat's chat in a room: sends the kept log at once (which also tells the client
 * that this server has chat), then every new line. Lines travel on their own channel, so
 * chat never bumps the room version or contends with game writes.
 *
 * Announcements are best-effort. A periodic look at the log delivers anything missed, and
 * the client merges lines by id, so a line sent twice does no harm.
 */
export async function openChat(
  store: GameStore,
  roomId: string,
  seat: Player,
  send: (message: ServerMessage) => void,
  options: ChatOptions = {},
): Promise<ChatLink> {
  const { resyncMs = 10_000, now = Date.now } = options;
  let closed = false;
  let ready = false;
  /** Ids of lines this connection has been sent. Pruned to what the log still keeps. */
  const sent = new Set<number>();
  const early: ChatMessage[] = [];
  let tokens = CHAT_BURST;
  let refilledAt = now();
  // oxlint-disable-next-line prefer-const -- close() reads it before it is assigned.
  let resync: ReturnType<typeof setInterval> | undefined;

  /** Sends the lines not sent yet, if any. Counts them as sent only once `send` returned. */
  const deliver = (lines: ChatMessage[]) => {
    if (closed) return;
    const fresh = lines.filter((line) => !sent.has(line.id));
    if (fresh.length === 0) return;
    send({ type: "chat", messages: fresh });
    for (const line of fresh) sent.add(line.id);
  };

  // Subscribed before the log is read, so no line can fall between the two.
  const unsubscribe = await store.subscribeChat(roomId, (update) => {
    if (update.roomId !== roomId) return;
    if (ready) deliver([update.message]);
    else early.push(update.message);
  });
  try {
    const log = await store.loadChat(roomId);
    // The first frame always goes out, even empty: it says this server has chat.
    send({ type: "chat", messages: log });
    for (const line of log) sent.add(line.id);
    ready = true;
    deliver(early.toSorted((a, b) => a.id - b.id));
  } catch (error) {
    unsubscribe();
    throw error;
  }

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(resync);
    unsubscribe();
  };

  resync = setInterval(() => {
    void (async () => {
      try {
        const log = await store.loadChat(roomId);
        if (closed) return;
        deliver(log);
        // Lines that have fallen off the log will not come round again.
        const oldest = log[0]?.id;
        if (oldest !== undefined) for (const id of sent) if (id < oldest) sent.delete(id);
      } catch (error) {
        console.error("Could not resync a room's chat", error);
      }
    })();
  }, resyncMs);
  // Never the reason a process stays alive.
  (resync as { unref?: () => void }).unref?.();

  /** Token bucket: `CHAT_BURST` lines at once, then one every `CHAT_REFILL_MS`. */
  const allowed = (): boolean => {
    const at = now();
    tokens = Math.min(CHAT_BURST, tokens + (at - refilledAt) / CHAT_REFILL_MS);
    refilledAt = at;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };

  return {
    async say(raw) {
      if (closed) return;
      const text = cleanChat(raw);
      if (text === null) return;
      if (!allowed()) {
        send({ type: "error", message: "You are sending messages too fast", fatal: false });
        return;
      }
      let line: ChatMessage;
      try {
        line = await store.appendChat(roomId, { from: seat, text, at: now() }, CHAT_KEEP);
      } catch (error) {
        console.error("Could not keep a chat line", error);
        send({ type: "error", message: "Could not send your message", fatal: false });
        return;
      }
      try {
        await store.publishChat(roomId, { roomId, message: line });
      } catch (error) {
        // Kept, so the other seat gets it at its next resync.
        console.error("Could not announce a chat line", error);
      }
      // If the announcement reached this connection, this is a no-op.
      deliver([line]);
    },
    close,
  };
}
