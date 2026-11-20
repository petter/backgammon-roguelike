# Backgammon Rogue-like

Backgammon with cards, played against a friend. Three.js + TypeScript + Vite.

- [ADR 0001](docs/adr/0001-engine-and-stack.md): engine and stack
- [ADR 0002](docs/adr/0002-multiplayer-architecture.md): multiplayer architecture

## Commands

- `pnpm dev`: the whole game, server included, with hot reload
- `pnpm dev --host`: same, reachable from other devices on your network
- `pnpm gate`: lint, typecheck, tests, build
- `pnpm format`: apply Biome fixes

## Playing locally

Run `pnpm dev` and open the printed URL. Start a game in one tab, then open a second tab and
enter the code (or paste the invite link). Each tab is its own player with its own hidden hand.

"Play both sides on this device" runs a hot-seat game with no server. Append `?seed=123` to
replay the same shuffles and dice.

Keys: `Space` rolls, `E` ends the turn. In development, `D` drops the connection to exercise
reconnecting. Rooms live in memory and are lost when the dev server restarts.

## How a turn works

1. Pick one of three cards offered from your deck (skipped when your hand holds five).
2. Roll.
3. Move checkers and play cards from your hand, in any order.
4. End the turn once no checker move is left.

## Layout

- `src/core`: rules, cards, seeded RNG, per-player views. No rendering or network imports.
- `src/server`: rooms, lobby API and socket handling, behind a `GameStore` interface.
- `src/net`: wire protocol and the client's session (local or remote).
- `src/render`: Three.js scene, board, checkers, effects. Plays back core events.
- `src/app`, `src/ui`: game controller and DOM overlay.
- `tests`: Vitest.

## Not built yet

- Deployment: the Vercel function entry points and the Redis `GameStore`.
- The rule that a roll must be played so as to use as many dice as possible.
- Characters, and any way to start a rematch.
