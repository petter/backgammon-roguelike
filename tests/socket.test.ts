import { describe, expect, it } from "vitest";

import { codeFromPath, parseClientMessage, type ServerMessage } from "../src/net/protocol.ts";
import { BODY_LIMIT, handleApi } from "../src/server/http.ts";
import { createMemoryStore } from "../src/server/memoryStore.ts";
import { createRoom, joinRoom } from "../src/server/room.ts";
import { serveSocket } from "../src/server/socket.ts";
import type { GameStore } from "../src/server/store.ts";

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
  // Lets the socket's message queue drain.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    sent,
    isOpen: () => open,
    say: async (message: unknown) => {
      onMessage(typeof message === "string" ? message : JSON.stringify(message));
      await settle();
    },
    hangUp: () => {
      open = false;
      onClose();
    },
  };
}

async function started() {
  const store = createMemoryStore();
  const host = await createRoom(store, "Ada");
  const guest = await joinRoom(store, host.code, "Grace");
  return { store, host, guest, code: host.code };
}

describe("serveSocket", () => {
  it("sends the state after hello and applies commands in order", async () => {
    const { store, host, guest, code } = await started();
    const white = fakeSocket(store, code);
    const black = fakeSocket(store, code);
    await white.say({ type: "hello", token: host.token });
    await black.say({ type: "hello", token: guest.token });
    expect(white.sent).toHaveLength(1);
    expect(white.sent[0]).toMatchObject({ type: "state", lobby: { you: "white" } });

    const first = white.sent[0]!.type === "state" && white.sent[0]!.view?.current === "white";
    const mover = first ? white : black;
    void mover.say({ type: "command", command: { type: "pickCard", index: 0 } });
    await mover.say({ type: "command", command: { type: "roll" } });
    await mover.say({ type: "command", command: { type: "roll" } });
    const kinds = mover.sent.map((m) =>
      m.type === "state" ? m.view?.phase : m.type === "error" ? m.message : m.type,
    );
    expect(kinds).toEqual(["pick", "roll", "move", "You cannot roll right now"]);
    expect(white.sent.filter((m) => m.type === "state")).toHaveLength(3);
    expect(black.sent.filter((m) => m.type === "state")).toHaveLength(3);
  });

  it("closes with a fatal error on a bad token, an unknown room or a bad code", async () => {
    const { store, code } = await started();
    for (const [room, token] of [
      [code, "wrong"],
      ["ZZZZZ", "wrong"],
      ["not a code", "wrong"],
    ] as const) {
      const socket = fakeSocket(store, room);
      await socket.say({ type: "hello", token });
      expect(socket.sent).toHaveLength(1);
      expect(socket.sent[0]).toMatchObject({ type: "error", fatal: true });
      expect(socket.isOpen()).toBe(false);
    }
  });

  it("closes on commands before hello, a second hello, and malformed input", async () => {
    const { store, host, code } = await started();
    const early = fakeSocket(store, code);
    await early.say({ type: "command", command: { type: "roll" } });
    expect(early.isOpen()).toBe(false);

    const twice = fakeSocket(store, code);
    await twice.say({ type: "hello", token: host.token });
    await twice.say({ type: "hello", token: host.token });
    expect(twice.isOpen()).toBe(false);

    for (const junk of [
      "not json",
      "null",
      "[]",
      '{"type":"command","command":{"type":"cheat"}}',
    ]) {
      const socket = fakeSocket(store, code);
      await socket.say({ type: "hello", token: host.token });
      await socket.say(junk);
      expect(socket.isOpen()).toBe(false);
    }
  });

  it("stops listening to the room once the client hangs up", async () => {
    const { store, host, guest, code } = await started();
    const white = fakeSocket(store, code);
    const black = fakeSocket(store, code);
    await white.say({ type: "hello", token: host.token });
    await black.say({ type: "hello", token: guest.token });
    const whiteFirst = white.sent[0]!.type === "state" && white.sent[0]!.view?.current === "white";
    const [mover, other] = whiteFirst ? [white, black] : [black, white];
    other.hangUp();
    await mover.say({ type: "command", command: { type: "pickCard", index: 0 } });
    expect(other.sent).toHaveLength(1);
    expect(mover.sent).toHaveLength(2);
  });

  it("does not subscribe a client that hung up while hello was in flight", async () => {
    const { store, host, guest, code } = await started();
    const ghost = fakeSocket(store, code);
    const hello = ghost.say({ type: "hello", token: host.token });
    ghost.hangUp();
    await hello;
    const black = fakeSocket(store, code);
    await black.say({ type: "hello", token: guest.token });
    await joinRoom(store, code, "Eve").catch(() => {});
    await store.publish(code, {
      room: { id: "other", code, version: 9, seats: {}, game: null },
      events: [],
    });
    expect(ghost.sent).toEqual([]);
  });
});

describe("a socket that closes with work outstanding", () => {
  /** A store whose reads can be held back, to catch a command in mid-flight. */
  function slowStore() {
    const inner = createMemoryStore();
    let gate: Promise<void> | null = null;
    let open: () => void = () => {};
    const store: GameStore = {
      ...inner,
      load: async (code) => {
        const room = await inner.load(code);
        if (gate) await gate;
        return room;
      },
    };
    return {
      inner,
      store,
      hold: () => {
        gate = new Promise<void>((resolve) => {
          open = resolve;
        });
      },
      release: () => {
        gate = null;
        open();
      },
    };
  }

  it("still carries out a command it had received, and tells the other player", async () => {
    const { inner, store, hold, release } = slowStore();
    const host = await createRoom(inner, "Ada");
    const guest = await joinRoom(inner, host.code, "Grace");
    const first = (await inner.load(host.code))?.game?.current;
    const mover = fakeSocket(store, host.code);
    const watcher = fakeSocket(inner, host.code);
    await mover.say({ type: "hello", token: first === "white" ? host.token : guest.token });
    await watcher.say({ type: "hello", token: first === "white" ? guest.token : host.token });
    const sentToMover = mover.sent.length;

    hold();
    const pending = mover.say({ type: "command", command: { type: "pickCard", index: 0 } });
    // The client moves to a replacement socket and this one goes away, mid-command.
    mover.hangUp();
    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const game = (await inner.load(host.code))?.game;
    expect((await inner.load(host.code))?.version).toBe(2);
    expect(game?.phase).toBe("roll");
    expect(watcher.sent.at(-1)).toMatchObject({ type: "state", version: 2 });
    // Nothing more is sent to the socket that closed.
    expect(mover.sent).toHaveLength(sentToMover);
  });

  it("carries out commands that were queued behind it too, in order", async () => {
    const { inner, store, hold, release } = slowStore();
    const host = await createRoom(inner, "Ada");
    const guest = await joinRoom(inner, host.code, "Grace");
    const first = (await inner.load(host.code))?.game?.current;
    const mover = fakeSocket(store, host.code);
    await mover.say({ type: "hello", token: first === "white" ? host.token : guest.token });
    hold();
    void mover.say({ type: "command", command: { type: "pickCard", index: 0 } });
    const last = mover.say({ type: "command", command: { type: "roll" } });
    mover.hangUp();
    release();
    await last;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const game = (await inner.load(host.code))?.game;
    expect(game?.phase).toBe("move");
    expect(game?.dice.length).toBeGreaterThan(0);
  });

  it("leaves no listener behind once the outstanding work is done", async () => {
    const { inner, store, hold, release } = slowStore();
    const host = await createRoom(inner, "Ada");
    const socket = fakeSocket(store, host.code);
    await socket.say({ type: "hello", token: host.token });
    hold();
    const pending = socket.say({ type: "command", command: { type: "roll" } });
    socket.hangUp();
    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const sent = socket.sent.length;
    await joinRoom(inner, host.code, "Grace");
    expect(socket.sent).toHaveLength(sent);
  });
});

describe("acknowledging commands", () => {
  it("sends done after the outcome of each command that carried an id, and only those", async () => {
    const { store, host, guest, code } = await started();
    const first = (await store.load(code))?.game?.current;
    const mover = fakeSocket(store, code);
    await mover.say({ type: "hello", token: first === "white" ? host.token : guest.token });
    await mover.say({ type: "command", command: { type: "pickCard", index: 0 }, id: 7 });
    await mover.say({ type: "command", command: { type: "endTurn" }, id: 8 });
    await mover.say({ type: "command", command: { type: "roll" } });
    const kinds = mover.sent.map((m) =>
      m.type === "done" ? `done ${m.id}` : m.type === "error" ? "error" : m.type,
    );
    // A change, then its acknowledgement; a refusal, then its acknowledgement; no id, no done.
    expect(kinds).toEqual(["state", "state", "done 7", "error", "done 8", "state"]);
  });

  it("rejects ids that are not whole non-negative numbers", () => {
    const base = '{"type":"command","command":{"type":"roll"},"id":';
    expect(parseClientMessage(`${base}3}`)).toEqual({
      type: "command",
      command: { type: "roll" },
      id: 3,
    });
    for (const id of ["-1", "1.5", '"3"', "null", "1e400", "{}"]) {
      expect(parseClientMessage(`${base}${id}}`), id).toBeNull();
    }
  });
});

describe("a close while hello is still in flight", () => {
  it("still carries out a command that was queued behind the hello, then lets go of the room", async () => {
    const inner = createMemoryStore();
    const host = await createRoom(inner, "Ada");
    const guest = await joinRoom(inner, host.code, "Grace");
    const first = (await inner.load(host.code))?.game?.current;
    let open: () => void = () => {};
    let gate: Promise<void> | null = new Promise<void>((resolve) => {
      open = resolve;
    });
    const store: GameStore = {
      ...inner,
      load: async (code) => {
        const room = await inner.load(code);
        if (gate) await gate;
        return room;
      },
    };
    const socket = fakeSocket(store, host.code);
    void socket.say({ type: "hello", token: first === "white" ? host.token : guest.token });
    const queued = socket.say({ type: "command", command: { type: "pickCard", index: 0 }, id: 1 });
    socket.hangUp();
    gate = null;
    open();
    await queued;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const room = await inner.load(host.code);
    expect(room?.version).toBe(2);
    expect(room?.game?.phase).toBe("roll");
    // Nothing was sent to the closed socket, and it is no longer listening to the room.
    expect(socket.sent).toEqual([]);
    const current = room?.game?.current;
    const other = fakeSocket(inner, host.code);
    await other.say({ type: "hello", token: current === "white" ? host.token : guest.token });
    await other.say({ type: "command", command: { type: "roll" } });
    expect(socket.sent).toEqual([]);
  });
});

describe("an unexpected server error", () => {
  it("closes the socket without condemning the seat", async () => {
    const inner = createMemoryStore();
    const host = await createRoom(inner, "Ada");
    let broken = false;
    const store: GameStore = {
      ...inner,
      load: async (code) => {
        if (broken) throw new Error("redis is down");
        return inner.load(code);
      },
    };
    const socket = fakeSocket(store, host.code);
    await socket.say({ type: "hello", token: host.token });
    broken = true;
    await socket.say({ type: "command", command: { type: "roll" } });
    expect(socket.sent.at(-1)).toEqual({
      type: "error",
      message: "Something went wrong on the server",
      fatal: false,
    });
    expect(socket.isOpen()).toBe(false);

    // Hello failing for the same reason is not fatal either.
    const again = fakeSocket(store, host.code);
    await again.say({ type: "hello", token: host.token });
    expect(again.sent).toEqual([
      { type: "error", message: "Something went wrong on the server", fatal: false },
    ]);
    expect(again.isOpen()).toBe(false);
  });
});

describe("ping", () => {
  it("is answered with pong, before and after hello, without touching the room", async () => {
    const { store, host, code } = await started();
    const before = (await store.load(code))?.version;
    const socket = fakeSocket(store, code);
    await socket.say({ type: "ping" });
    expect(socket.sent).toEqual([{ type: "pong" }]);
    await socket.say({ type: "hello", token: host.token });
    await socket.say({ type: "ping", extra: "ignored" });
    expect(socket.sent.map((m) => m.type)).toEqual(["pong", "state", "pong"]);
    expect(socket.isOpen()).toBe(true);
    expect((await store.load(code))?.version).toBe(before);
  });
});

describe("parseClientMessage", () => {
  it("accepts well-formed messages and strips unknown fields", () => {
    expect(parseClientMessage('{"type":"command","command":{"type":"rematch","x":1}}')).toEqual({
      type: "command",
      command: { type: "rematch" },
    });
    expect(parseClientMessage('{"type":"hello","token":"abc","extra":1}')).toEqual({
      type: "hello",
      token: "abc",
    });
    expect(
      parseClientMessage(
        '{"type":"command","command":{"type":"move","from":"bar","to":3,"die":3,"player":"black"}}',
      ),
    ).toEqual({ type: "command", command: { type: "move", from: "bar", to: 3, die: 3 } });
    expect(
      parseClientMessage(
        '{"type":"command","command":{"type":"move","from":5,"to":"off","die":6}}',
      ),
    ).toEqual({ type: "command", command: { type: "move", from: 5, to: "off", die: 6 } });
  });

  it("rejects anything else", () => {
    for (const text of [
      "",
      "{",
      "42",
      '{"type":"hello"}',
      '{"type":"hello","token":5}',
      `{"type":"hello","token":"${"x".repeat(101)}"}`,
      '{"type":"command"}',
      '{"type":"command","command":{"type":"pickCard"}}',
      '{"type":"command","command":{"type":"pickCard","index":-1}}',
      '{"type":"command","command":{"type":"pickCard","index":1.5}}',
      '{"type":"command","command":{"type":"playCard","index":"0"}}',
      '{"type":"command","command":{"type":"move","from":"off","to":3,"die":3}}',
      '{"type":"command","command":{"type":"move","from":3,"to":"bar","die":3}}',
      '{"type":"command","command":{"type":"move","from":3,"to":2}}',
    ]) {
      expect(parseClientMessage(text), text).toBeNull();
    }
  });
});

describe("codeFromPath", () => {
  it("reads the code from an invite path, in either case", () => {
    expect(codeFromPath("/g/ABCDE")).toBe("ABCDE");
    expect(codeFromPath("/g/abcde")).toBe("ABCDE");
    expect(codeFromPath("/g/abcde/")).toBe("ABCDE");
  });

  it("returns null for anything else, without throwing", () => {
    for (const path of [
      "/",
      "/g/",
      "/g/BAD",
      "/g/ABCDEF",
      "/g/ABCDI",
      "/g/%",
      "/g/%FF",
      "/g/%41BCDE",
      "/g/AB CDE",
      "/g/ABCDE/extra",
      "/x/ABCDE",
    ]) {
      expect(codeFromPath(path), path).toBeNull();
    }
  });
});

describe("handleApi", () => {
  it("creates and joins rooms", async () => {
    const store = createMemoryStore();
    const created = await handleApi(store, "POST", "/api/rooms", '{"name":"Ada"}');
    expect(created.status).toBe(201);
    const { code } = created.body as { code: string; token: string };

    const joined = await handleApi(store, "POST", `/api/rooms/${code.toLowerCase()}/join`, "");
    expect(joined.status).toBe(200);
    expect((joined.body as { code: string }).code).toBe(code);
    expect((await store.load(code))?.seats.black?.name).toBe("Guest");

    expect((await handleApi(store, "POST", `/api/rooms/${code}/join`, "{}")).status).toBe(409);
  });

  it("takes the character from the request, and the default when it is not a known one", async () => {
    const store = createMemoryStore();
    const body = '{"name":"Ada","character":"corsair"}';
    const { code } = (await handleApi(store, "POST", "/api/rooms", body)).body as { code: string };
    await handleApi(store, "POST", `/api/rooms/${code}/join`, '{"character":["seer"]}');
    const room = await store.load(code);
    expect(room?.seats.white?.character).toBe("corsair");
    expect(room?.seats.black?.character).toBe("gambler");
    for (const odd of ['"seer"', "[1]", "7", "null"]) {
      expect((await handleApi(store, "POST", "/api/rooms", odd)).status, odd).toBe(201);
    }
  });

  it("refuses malformed JSON without taking the seat", async () => {
    const store = createMemoryStore();
    const { code } = (await handleApi(store, "POST", "/api/rooms", "")).body as { code: string };
    for (const junk of ["{", "name=Ada", '{"name":']) {
      expect((await handleApi(store, "POST", `/api/rooms/${code}/join`, junk)).status).toBe(400);
      expect((await handleApi(store, "POST", "/api/rooms", junk)).status).toBe(400);
    }
    expect((await store.load(code))?.seats.black).toBeUndefined();
    expect((await store.load(code))?.game).toBeNull();
    expect((await handleApi(store, "POST", `/api/rooms/${code}/join`, "  ")).status).toBe(200);
  });

  it("ignores JSON that is valid but not an object", async () => {
    const store = createMemoryStore();
    for (const body of ["null", "42", '"Ada"', "[]", '{"name":{"a":1}}']) {
      const created = await handleApi(store, "POST", "/api/rooms", body);
      expect(created.status).toBe(201);
      const { code } = created.body as { code: string };
      expect((await store.load(code))?.seats.white?.name).toBe("Host");
    }
  });

  it("refuses an oversized body with 413 and creates nothing", async () => {
    const store = createMemoryStore();
    const { code } = (await handleApi(store, "POST", "/api/rooms", "")).body as { code: string };
    const big = JSON.stringify({ name: "a".repeat(BODY_LIMIT) });
    expect((await handleApi(store, "POST", "/api/rooms", big)).status).toBe(413);
    expect((await handleApi(store, "POST", `/api/rooms/${code}/join`, big)).status).toBe(413);
    expect((await store.load(code))?.seats.black).toBeUndefined();
    const fits = JSON.stringify({ name: "a".repeat(BODY_LIMIT - 11) });
    expect(fits).toHaveLength(BODY_LIMIT);
    expect((await handleApi(store, "POST", "/api/rooms", fits)).status).toBe(201);
  });

  it("maps failures to status codes", async () => {
    const store = createMemoryStore();
    expect((await handleApi(store, "POST", "/api/rooms/ZZZZZ/join", "{}")).status).toBe(404);
    expect((await handleApi(store, "POST", "/api/rooms/nope!/join", "{}")).status).toBe(404);
    expect((await handleApi(store, "GET", "/api/rooms", "{}")).status).toBe(405);
    expect((await handleApi(store, "POST", "/api/other", "{}")).status).toBe(404);
    expect((await handleApi(store, "POST", "/api/rooms/AAAAA/steal", "{}")).status).toBe(404);
  });
});
