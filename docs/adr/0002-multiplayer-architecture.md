# ADR 0002: Multiplayer architecture

- Status: accepted
- Date: 2026-11-20

## Context

The main mode is friend-vs-friend matches. Each player's cards are hidden from the other, so two players cannot share a device.

First version:

1. A player starts a game and gets a code.
2. Their friend enters the code and lands in the same lobby.

No accounts and no stored player data. At most a name, and possibly a character, chosen when creating or joining a lobby.

Constraints:

- Hosted on Vercel, as a single deployable.
- Hidden hands and dice must not be readable or forgeable from the browser.

## Decision

Authoritative server on Vercel. Clients are thin views.

| Piece                       | Choice                                                 |
| --------------------------- | ------------------------------------------------------ |
| Client                      | Vite build, served as static files by Vercel           |
| Game server                 | Vercel Functions under `/api`, same project and domain |
| Transport                   | WebSocket endpoint per room, on Vercel Functions       |
| Live game state and fan-out | Redis from the Vercel Marketplace (Upstash)            |
| Durable database            | None for now                                           |

One repo, one Vercel project, one deploy. Redis is a managed add-on, not a second deployable.

## Server authority

- The server runs `src/core`. The same code runs in the client for solo play and tests.
- Clients send commands (`roll`, `playMove`, `playCard`), never state. The server validates them with the core's legality checks.
- The server sends each player a redacted view: own hand in full, the opponent's hand as a count, decks as counts.
- Events are filtered the same way. A player sees that the opponent drew a card, not which one.
- The RNG seed never leaves the server.

## Lobby flow

1. **Create:** the server generates a short code, stores a new lobby in Redis, and returns the code and a seat token.
2. **Join:** the friend enters the code, or opens `/g/CODE`, and receives the second seat token.
3. **Play:** both open a WebSocket to the room and present their token. The game starts when both seats are filled.

A seat token is a random secret kept in the browser's `sessionStorage`. The server uses it to route each hidden hand to the right connection and to let a player back into their seat after a refresh or a dropped connection. It is not player data.

## State and storage

- Function handlers are stateless: load the game from Redis, apply the command with the core, save, publish to the room channel.
- Each connection subscribes to its room channel and forwards the view meant for its seat. This is needed because the two players can land on different function instances.
- Saved games carry a version number. Writes are compare-and-set, so two racing commands cannot both apply.
- Name and character live in the lobby record, next to the game state.
- Every record expires (for example 24 hours after the last move). Abandoned games clean themselves up.

## Code structure

- `src/core`: rules, plus `viewFor(state, player)` and per-player event filtering.
- `src/` (rest): client. The controller talks to a session interface, not to the core directly.
- Session implementations: local (solo, hot-seat, tests) and remote (WebSocket). The renderer does not know which it has.
- `api/`: create lobby, join lobby, room WebSocket.

## Local development and testing

`pnpm dev` must give a fully playable multiplayer game with no Redis, no Docker and no Vercel login.

- The room handler takes a `GameStore` (load, compare-and-set save, publish, subscribe) instead of calling Redis directly. Two implementations: in-memory and Redis.
- `pnpm dev` runs the game server inside Vite's own dev server, as a plugin (`src/server/devPlugin.ts`) that wraps the same room handler with the in-memory store. One process, one port, and the client uses the same `/api` URLs as in production.
- Two browser tabs are two players, because seat tokens live in `sessionStorage`, which is per tab.
- A dev-only command forces a disconnect, to exercise reconnect and resync.

Test levels:

- **Rules:** Vitest against `src/core`.
- **Server logic:** Vitest drives the room handler with two fake players and the in-memory store. Covers lobby flow, redaction, rejected commands and racing writes.
- **Redis adapter:** one contract test suite runs against both store implementations. Needs a local Redis or a throwaway Upstash database.
- **Vercel behaviour:** preview deployments, pointed at a Redis database separate from production.

## Alternatives rejected

- **Cloudflare Durable Objects**: the simplest model, one in-memory object per room. Rejected to stay on one platform.
- **Node server with Colyseus**: conventional, but an always-on box to run and pay for.
- **Peer-to-peer WebRTC**: one peer would have to hold the other's secrets.
- **Firebase or Supabase realtime**: hidden information still needs server code.
- **Neon or Turso**: available, but nothing durable to store yet.

## Consequences

- WebSocket connections close when the function reaches its maximum duration, reportedly about 5 minutes by default. The client must reconnect and resync; the server resends the current view.
- More moving parts than a single in-memory room: Redis, pub/sub, versioned writes.
- The game is turn-based, so there is no prediction or rollback to build.
- Solo and hot-seat play keep working with no server, through the local session.

## To verify when building

- Current status and limits of WebSockets on Vercel Functions. It launched as a public beta in June 2026 and was reported generally available in October 2026, but some Vercel pages still described it as beta.
- Whether `vercel dev` serves the WebSocket endpoint locally. Fallback: a small local Node wrapper around the same handler.

## Revisit if

- Accounts, match history, card collections or run progression are added. Add Neon then.
- Vercel's WebSocket limits prove too tight for a full match.
