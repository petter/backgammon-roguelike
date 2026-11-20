# Backgammon Rogue-like

Backgammon with cards. Three.js + TypeScript + Vite; see [ADR 0001](docs/adr/0001-engine-and-stack.md).

## Commands

- `pnpm dev`: dev server with hot reload
- `pnpm gate`: lint, typecheck, tests, build
- `pnpm format`: apply Biome fixes

Append `?seed=123` to the URL to replay the same dice.

## Layout

- `src/core`: rules, state, seeded RNG. No rendering imports; runs headless.
- `src/render`: Three.js scene, board, checkers, effects. Plays back core events.
- `src/ui`: DOM overlay.
- `tests`: Vitest.
