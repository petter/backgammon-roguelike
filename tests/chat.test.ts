import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeChat } from "../src/app/chatLog.ts";
import {
  CHAT_KEEP,
  CHAT_MAX,
  type ChatMessage,
  cleanChat,
  parseClientMessage,
  type ServerMessage,
} from "../src/net/protocol.ts";
import { CHAT_BURST, CHAT_REFILL_MS, openChat } from "../src/server/chat.ts";
import { createMemoryStore } from "../src/server/memoryStore.ts";
import { createRoom, joinRoom } from "../src/server/room.ts";
import { serveSocket } from "../src/server/socket.ts";
import type { GameStore } from "../src/server/store.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeSocket(store: GameStore, code: string) {
  const sent: ServerMessage[] = [];
  let onMessage: (text: string) => void = () => {};
  let onClose: () => void = () => {};
  let open = true;
  serveSocket(store, code, {
    send: (text) => sent.push(JSON.parse(text) as ServerMessage),
    close: () => {
      if (!open) return;
      open = false;
      onClose();
    },
    onMessage: (listener) => {
      onMessage = listener;
    },
    onClose: (listener) => {
      onClose = listener;
    },
  });
  return {
    sent,
    isOpen: () => open,
    say: async (message: unknown) => {
      onMessage(JSON.stringify(message));
      await settle();
    },
    hangUp: async () => {
      open = false;
      onClose();
      await settle();
    },
    /** Every chat line this socket was sent, in the order it was sent. */
    lines: () => sent.flatMap((m) => (m.type === "chat" ? m.messages : [])),
    chatFrames: () => sent.filter((m) => m.type === "chat"),
    errors: () => sent.flatMap((m) => (m.type === "error" ? [m] : [])),
  };
}

async function seated() {
  const store = createMemoryStore();
  const host = await createRoom(store, "Ada");
  const guest = await joinRoom(store, host.code, "Grace");
  const white = fakeSocket(store, host.code);
  const black = fakeSocket(store, host.code);
  await white.say({ type: "hello", token: host.token, presence: true, chat: true });
  await black.say({ type: "hello", token: guest.token, presence: true, chat: true });
  return { store, host, guest, white, black };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("chat over a room socket", () => {
  it("sends the log after the state, even empty, to say the server has chat", async () => {
    const { white } = await seated();
    expect(white.sent.map((m) => m.type)).toEqual(["state", "chat"]);
    expect(white.chatFrames()).toEqual([{ type: "chat", messages: [] }]);
  });

  it("carries a line to both seats, numbered and marked with who said it", async () => {
    const { white, black } = await seated();
    await white.say({ type: "chat", text: "  good luck!  " });
    const line = { from: "white", text: "good luck!" };
    expect(white.lines()).toMatchObject([line]);
    expect(black.lines()).toEqual(white.lines());
    await black.say({ type: "chat", text: "you too" });
    const [first] = white.lines();
    expect(white.lines().map((l) => [l.id - first!.id, l.from])).toEqual([
      [0, "white"],
      [1, "black"],
    ]);
  });

  it("does not bump the room version or touch the game", async () => {
    const { store, host, white } = await seated();
    const before = await store.load(host.code);
    await white.say({ type: "chat", text: "hi" });
    expect(await store.load(host.code)).toEqual(before);
    expect(white.sent.filter((m) => m.type === "state")).toHaveLength(1);
  });

  it("gives a reconnecting seat what was said meanwhile", async () => {
    const { store, host, guest, white, black } = await seated();
    await black.hangUp();
    await white.say({ type: "chat", text: "where did you go?" });
    const back = fakeSocket(store, host.code);
    await back.say({ type: "hello", token: guest.token, chat: true });
    expect(back.chatFrames()).toMatchObject([{ messages: [{ text: "where did you go?" }] }]);
  });

  it("never sends chat frames to a client that did not ask for them", async () => {
    const { store, host, guest, white } = await seated();
    const old = fakeSocket(store, host.code);
    await old.say({ type: "hello", token: guest.token, presence: true });
    await white.say({ type: "chat", text: "hello?" });
    expect(old.chatFrames()).toEqual([]);
    // Its own line goes nowhere, and does not cost it the seat.
    await old.say({ type: "chat", text: "hi" });
    expect(old.isOpen()).toBe(true);
    expect(white.lines().map((l) => l.text)).toEqual(["hello?"]);
  });

  it("never holds up the game while chat is slow to open", async () => {
    const store = createMemoryStore();
    const host = await createRoom(store, "Ada");
    await joinRoom(store, host.code, "Grace");
    let release: (lines: ChatMessage[]) => void = () => {};
    const stalled: GameStore = {
      ...store,
      loadChat: () => new Promise((resolve) => (release = resolve)),
    };
    const white = fakeSocket(stalled, host.code);
    await white.say({ type: "hello", token: host.token, chat: true });
    await white.say({ type: "ping" });
    await white.say({ type: "command", command: { type: "pickCard", index: 0 }, id: 7 });
    expect(white.sent.map((m) => m.type)).toContain("pong");
    expect(white.sent).toContainEqual({ type: "done", id: 7 });
    expect(white.chatFrames()).toEqual([]);
    // Closed while still opening: once open, it lets go and says nothing.
    await white.hangUp();
    release([]);
    await settle();
    expect(white.chatFrames()).toEqual([]);
  });

  it("never holds up the game while a chat line is slow to keep", async () => {
    const { store, host } = await seated();
    const stalled: GameStore = { ...store, appendChat: () => new Promise(() => {}) };
    const white = fakeSocket(stalled, host.code);
    await white.say({ type: "hello", token: host.token, chat: true });
    await white.say({ type: "chat", text: "hello?" });
    await white.say({ type: "ping" });
    await white.say({ type: "command", command: { type: "pickCard", index: 0 }, id: 7 });
    expect(white.sent.map((m) => m.type)).toContain("pong");
    expect(white.sent).toContainEqual({ type: "done", id: 7 });
  });

  it("keeps every line received before a close, even behind a slow one", async () => {
    const { store, host, black } = await seated();
    let release = () => {};
    const slow: GameStore = {
      ...store,
      appendChat: async (...args) => {
        await new Promise<void>((resolve) => (release = resolve));
        slow.appendChat = store.appendChat;
        return store.appendChat(...args);
      },
    };
    const white = fakeSocket(slow, host.code);
    await white.say({ type: "hello", token: host.token, chat: true });
    await white.say({ type: "chat", text: "first" });
    await white.say({ type: "chat", text: "second" });
    await white.hangUp();
    release();
    await settle();
    expect(black.lines().map((l) => l.text)).toEqual(["first", "second"]);
  });

  it("refuses chat before hello, like any other message", async () => {
    const { store, host } = await seated();
    const early = fakeSocket(store, host.code);
    await early.say({ type: "chat", text: "hi" });
    expect(early.isOpen()).toBe(false);
  });

  it("drops blank lines quietly and cuts long ones", async () => {
    const { white, black } = await seated();
    await white.say({ type: "chat", text: " \n\t " });
    await white.say({ type: "chat", text: "x".repeat(CHAT_MAX + 50) });
    expect(white.errors()).toEqual([]);
    expect(black.lines().map((l) => l.text.length)).toEqual([CHAT_MAX]);
  });

  it("slows down a seat that sends too much too fast, without ending it", async () => {
    const { white, black } = await seated();
    for (let i = 0; i <= CHAT_BURST; i++) await white.say({ type: "chat", text: `line ${i}` });
    expect(black.lines()).toHaveLength(CHAT_BURST);
    expect(white.errors()).toEqual([
      { type: "error", message: "You are sending messages too fast", fatal: false },
    ]);
    expect(white.isOpen()).toBe(true);
  });

  it("stops sending to a socket once it has closed", async () => {
    const { white, black } = await seated();
    await black.hangUp();
    const before = black.sent.length;
    await white.say({ type: "chat", text: "anyone?" });
    expect(black.sent).toHaveLength(before);
  });
});

describe("a chat log that expires before its room", () => {
  it("never hands out an id again", async () => {
    let now = 1_764_000_000_000;
    const ttlMs = 1000;
    const store = createMemoryStore(ttlMs, () => now);
    const line = (at: number) => ({ from: "white" as const, text: "hi", at });
    const before = [];
    for (let i = 0; i < 3; i++) before.push(await store.appendChat("room-1", line(now), 50));
    now += ttlMs;
    expect(await store.loadChat("room-1")).toEqual([]);
    const after = await store.appendChat("room-1", line(now), 50);
    expect(after.id).toBeGreaterThan(Math.max(...before.map((l) => l.id)));
  });
});

describe("openChat", () => {
  it("refills the rate limit over time", async () => {
    let now = 0;
    const store = createMemoryStore();
    const sent: ServerMessage[] = [];
    const chat = await openChat(store, "room-1", "white", (m) => sent.push(m), {
      now: () => now,
    });
    for (let i = 0; i < CHAT_BURST + 1; i++) await chat.say(`a${i}`);
    expect(sent.filter((m) => m.type === "error")).toHaveLength(1);
    now += CHAT_REFILL_MS;
    await chat.say("again");
    expect(sent.filter((m) => m.type === "error")).toHaveLength(1);
    expect((await store.loadChat("room-1")).map((l) => l.text).at(-1)).toBe("again");
    chat.close();
  });

  it("delivers a line whose announcement was lost at the next resync", async () => {
    vi.useFakeTimers();
    const store = createMemoryStore();
    const lost: GameStore = { ...store, publishChat: () => Promise.reject(new Error("down")) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const heard: ServerMessage[] = [];
    const listener = await openChat(store, "room-1", "black", (m) => heard.push(m), {
      resyncMs: 1000,
    });
    const speaker = await openChat(lost, "room-1", "white", () => {}, { resyncMs: 1000 });
    await speaker.say("can you hear me?");
    expect(heard).toEqual([{ type: "chat", messages: [] }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(heard.at(-1)).toMatchObject({ messages: [{ text: "can you hear me?" }] });
    // And only once.
    await vi.advanceTimersByTimeAsync(3000);
    expect(heard).toHaveLength(2);
    listener.close();
    speaker.close();
  });

  it("tells the speaker when a line could not be kept", async () => {
    const store = createMemoryStore();
    const broken: GameStore = { ...store, appendChat: () => Promise.reject(new Error("down")) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sent: ServerMessage[] = [];
    const chat = await openChat(broken, "room-1", "white", (m) => sent.push(m));
    await chat.say("hi");
    expect(sent.at(-1)).toEqual({
      type: "error",
      message: "Could not send your message",
      fatal: false,
    });
    chat.close();
  });
});

describe("cleanChat", () => {
  it("keeps one trimmed line without control or direction-changing characters", () => {
    expect(cleanChat("  hi\nthere\u0000 ")).toBe("hi there");
    expect(cleanChat("a‮b⁦c")).toBe("abc");
    expect(cleanChat("   ")).toBeNull();
    expect(cleanChat(42)).toBeNull();
  });

  it("cuts by characters, never splitting one", () => {
    const text = cleanChat("🎲".repeat(CHAT_MAX + 5));
    expect(Array.from(text ?? "")).toHaveLength(CHAT_MAX);
    expect(text?.endsWith("🎲")).toBe(true);
  });
});

describe("parseClientMessage chat", () => {
  it("keeps the text and the hello flag, and refuses junk", () => {
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "hi", x: 1 }))).toEqual({
      type: "chat",
      text: "hi",
    });
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "" }))).toEqual({
      type: "chat",
      text: "",
    });
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: 5 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "x".repeat(5000) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "hello", token: "t", chat: true }))).toEqual({
      type: "hello",
      token: "t",
      chat: true,
    });
  });
});

describe("mergeChat", () => {
  const line = (id: number, text = `line ${id}`): ChatMessage => ({
    id,
    from: "white",
    text,
    at: 0,
  });

  it("orders by id and reports only what is new", () => {
    const first = mergeChat([], [line(2), line(1)]);
    expect(first.log.map((l) => l.id)).toEqual([1, 2]);
    expect(first.added.map((l) => l.id)).toEqual([2, 1]);
    const again = mergeChat(first.log, [line(1), line(2), line(3)]);
    expect(again.log.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(again.added.map((l) => l.id)).toEqual([3]);
  });

  it("keeps only the newest lines", () => {
    const many = Array.from({ length: CHAT_KEEP + 3 }, (_, i) => line(i + 1));
    const { log } = mergeChat([], many);
    expect(log).toHaveLength(CHAT_KEEP);
    expect(log[0]?.id).toBe(4);
  });
});
