import { describe, expect, it } from "vitest";
import { type Command, canPlayCard, legalMoves } from "../src/core/game.ts";
import { isRoomCode, type ServerMessage } from "../src/net/protocol.ts";
import { createMemoryStore } from "../src/server/memoryStore.ts";
import { createRoom, joinRoom, openConnection, RoomError } from "../src/server/room.ts";
import type { GameStore } from "../src/server/store.ts";

type State = Extract<ServerMessage, { type: "state" }>;

async function client(store: GameStore, code: string, token: string) {
  const inbox: ServerMessage[] = [];
  const connection = await openConnection(store, code, token, (m) => inbox.push(m));
  return {
    inbox,
    connection,
    send: (command: Command) => connection.command(command),
    last: () => inbox.filter((m): m is State => m.type === "state").at(-1) as State,
    errors: () => inbox.flatMap((m) => (m.type === "error" ? [m.message] : [])),
  };
}

/** A started game with both players connected. */
async function table(store: GameStore = createMemoryStore()) {
  const host = await createRoom(store, "Ada");
  const guest = await joinRoom(store, host.code, "Grace");
  const white = await client(store, host.code, host.token);
  const black = await client(store, host.code, guest.token);
  const first = white.last().view?.current === "white" ? white : black;
  const second = first === white ? black : white;
  return { store, code: host.code, host, guest, white, black, first, second };
}

describe("lobby", () => {
  it("creates a room with a well-formed code and a host seat", async () => {
    const store = createMemoryStore();
    const { code, token } = await createRoom(store, "  Ada   Lovelace  ");
    expect(isRoomCode(code)).toBe(true);
    const room = await store.load(code);
    expect(room?.seats.white).toEqual({ token, name: "Ada Lovelace" });
    expect(room?.game).toBeNull();
  });

  it("falls back to a default name and trims long ones", async () => {
    const store = createMemoryStore();
    const a = await createRoom(store, "   ");
    const b = await createRoom(store, "x".repeat(200));
    const c = await createRoom(store, { not: "a string" });
    expect((await store.load(a.code))?.seats.white?.name).toBe("Host");
    expect((await store.load(b.code))?.seats.white?.name).toHaveLength(20);
    expect((await store.load(c.code))?.seats.white?.name).toBe("Host");
  });

  it("retries when a generated code is already taken", async () => {
    const store = createMemoryStore();
    const digits = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
    const entropy = { token: () => "tok", int: () => digits.shift() ?? 2 };
    expect((await createRoom(store, "a", entropy)).code).toBe("AAAAA");
    expect((await createRoom(store, "b", entropy)).code).toBe("BBBBB");
  });

  it("shows the host a waiting lobby until the guest joins, then starts the game", async () => {
    const store = createMemoryStore();
    const host = await createRoom(store, "Ada");
    const white = await client(store, host.code, host.token);
    expect(white.last()).toMatchObject({
      version: 0,
      view: null,
      lobby: { code: host.code, you: "white", players: { white: { name: "Ada" }, black: null } },
    });

    await joinRoom(store, host.code, "Grace");
    expect(white.last().version).toBe(1);
    expect(white.last().lobby.players.black).toEqual({ name: "Grace" });
    expect(white.last().view?.you).toBe("white");
  });

  it("refuses a third player, an unknown code and a wrong token", async () => {
    const { store, code } = await table();
    await expect(joinRoom(store, code, "Eve")).rejects.toMatchObject({ kind: "full" });
    await expect(joinRoom(store, "ZZZZZ", "Eve")).rejects.toMatchObject({ kind: "not_found" });
    await expect(client(store, code, "nope")).rejects.toMatchObject({ kind: "bad_token" });
    await expect(client(store, code, "")).rejects.toBeInstanceOf(RoomError);
    await expect(client(store, "ZZZZZ", "nope")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("gives two players racing for the last seat exactly one of it", async () => {
    const store = createMemoryStore();
    const host = await createRoom(store, "Ada");
    const results = await Promise.allSettled([
      joinRoom(store, host.code, "Grace"),
      joinRoom(store, host.code, "Eve"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.load(host.code))?.version).toBe(1);
  });

  it("never sends a seat token to anyone", async () => {
    const { white, black, host, guest, first } = await table();
    await first.send({ type: "pickCard", index: 0 });
    const wire = JSON.stringify([...white.inbox, ...black.inbox]);
    expect(wire).not.toContain(host.token);
    expect(wire).not.toContain(guest.token);
  });
});

describe("playing", () => {
  it("sends both players each change, with the picked card hidden from the opponent", async () => {
    const { first, second } = await table();
    const offer = first.last().view?.offer ?? [];
    expect(offer).toHaveLength(3);
    expect(second.last().view?.offer).toEqual([]);

    await first.send({ type: "pickCard", index: 2 });
    const mover = first.last().view?.you;
    expect(first.last().events).toEqual([{ type: "cardPicked", player: mover, card: offer[2] }]);
    expect(second.last().events).toEqual([{ type: "cardPicked", player: mover, card: null }]);
    expect(first.last().view?.hand).toEqual([offer[2]]);
    expect(second.last().view?.hand).toEqual([]);
    expect(second.last().view?.counts[mover ?? "white"].hand).toBe(1);
    expect(first.last().version).toBe(second.last().version);
  });

  it("keeps the opponent's cards and the RNG off the wire for a whole game", async () => {
    const { store, code, white, black } = await table();
    for (let step = 0; step < 2000; step++) {
      const mover = white.last().view?.current === "white" ? white : black;
      const mine = mover.last().view;
      if (!mine || mine.phase === "over") break;
      const [move] = legalMoves(mine);
      // Hold a few cards back, so hands are never empty when the wire is inspected.
      const playable = mine.hand.length > 3 ? mine.hand.findIndex((c) => canPlayCard(mine, c)) : -1;
      if (mine.phase === "pick") await mover.send({ type: "pickCard", index: 0 });
      else if (mine.phase === "roll") await mover.send({ type: "roll" });
      else if (move)
        await mover.send({ type: "move", from: move.from, to: move.to, die: move.die });
      else if (playable >= 0) await mover.send({ type: "playCard", index: playable });
      else await mover.send({ type: "endTurn" });
    }
    expect((await store.load(code))?.game?.phase).toBe("over");
    expect(white.last().view?.winner).toBe(black.last().view?.winner);

    for (const { inbox } of [white, black]) {
      for (const message of inbox) {
        if (message.type !== "state") continue;
        const wire = JSON.stringify(message);
        expect(wire).not.toContain('"rng"');
        expect(wire).not.toContain('"deck":[');
        expect(wire).not.toContain('"cards":{');
        for (const event of message.events) {
          if (event.type === "cardsOffered" && event.player !== message.lobby.you) {
            expect(event.cards).toBeNull();
          }
          if (event.type === "cardPicked" && event.player !== message.lobby.you) {
            expect(event.card).toBeNull();
          }
        }
      }
    }
  });

  it("answers a rule violation with an error to the sender only, and changes nothing", async () => {
    const { store, code, first, second } = await table();
    const before = (await store.load(code))?.version;
    const sent = second.inbox.length;

    await second.send({ type: "roll" });
    expect(second.errors()).toEqual(["It is not your turn"]);
    await first.send({ type: "endTurn" });
    expect(first.errors()).toEqual(["Roll before ending your turn"]);
    await first.send({ type: "pickCard", index: 7 });
    expect(first.errors()).toHaveLength(2);

    expect((await store.load(code))?.version).toBe(before);
    expect(second.inbox.length).toBe(sent + 1);
  });

  it("refuses commands before the game has started", async () => {
    const store = createMemoryStore();
    const host = await createRoom(store, "Ada");
    const white = await client(store, host.code, host.token);
    await white.send({ type: "roll" });
    expect(white.errors()).toEqual(["The game has not started yet"]);
  });

  it("applies each of two racing commands at most once", async () => {
    const { store, code, first } = await table();
    const before = (await store.load(code))?.version ?? 0;
    await Promise.all([
      first.send({ type: "pickCard", index: 0 }),
      first.send({ type: "pickCard", index: 1 }),
    ]);
    const room = await store.load(code);
    expect(room?.version).toBe(before + 1);
    expect(room?.game?.cards[room.game.current].hand).toHaveLength(1);
    expect(first.errors()).toEqual(["There is no card to pick right now"]);
  });

  it("retries a save that lost the race, without losing the other writer's change", async () => {
    const inner = createMemoryStore();
    let failNext = false;
    const flaky: GameStore = {
      ...inner,
      async save(room, expected) {
        if (failNext) {
          failNext = false;
          // Someone else writes first: bump the version underneath this writer.
          const current = await inner.load(room.code);
          if (current) await inner.save({ ...current, version: current.version + 1 }, expected);
        }
        return inner.save(room, expected);
      },
    };
    const { store, code, first } = await table(flaky);
    const before = (await store.load(code))?.version ?? 0;
    failNext = true;
    await first.send({ type: "pickCard", index: 0 });
    expect(first.errors()).toEqual([]);
    expect((await store.load(code))?.version).toBe(before + 2);
    expect(first.last().view?.hand).toHaveLength(1);
  });

  it("gives up with an error when the room stays contended", async () => {
    const inner = createMemoryStore();
    let block = false;
    const stuck: GameStore = { ...inner, save: async (r, e) => (block ? false : inner.save(r, e)) };
    const { first } = await table(stuck);
    block = true;
    await first.send({ type: "pickCard", index: 0 });
    expect(first.errors()).toEqual(["The game is busy, try again"]);
  });

  it("resyncs a player who reconnects, and stops sending after close", async () => {
    const { store, code, host, guest, white, black, first } = await table();
    const dropped = first === white ? black : white;
    const token = dropped === white ? host.token : guest.token;
    dropped.connection.close();
    const seen = dropped.inbox.length;

    await first.send({ type: "pickCard", index: 0 });
    await first.send({ type: "roll" });
    expect(dropped.inbox.length).toBe(seen);

    const back = await client(store, code, token);
    expect(back.inbox).toHaveLength(1);
    expect(back.last().events).toEqual([]);
    expect(back.last().version).toBe(first.last().version);
    expect(back.last().view?.dice).toEqual(first.last().view?.dice);
    expect(back.last().view?.phase).toBe("move");
  });

  it("reports a room that vanished as a fatal error", async () => {
    let gone = false;
    const inner = createMemoryStore();
    const store: GameStore = { ...inner, load: async (c) => (gone ? null : inner.load(c)) };
    const { first } = await table(store);
    gone = true;
    await first.send({ type: "pickCard", index: 0 });
    expect(first.inbox.at(-1)).toEqual({
      type: "error",
      message: "That game no longer exists",
      fatal: true,
    });
  });
});
