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

## Dice

The dice are physical objects on the board. A roll throws them from the roller's edge; they
bounce off the felt, the rims, the checkers and each other. The server decides the result
before the throw: the client simulates the throw, then paints each die so that the face it
lands on shows the server's value. Cards that change the dice throw them again.

## Cards

Each player has their own deck of 11 cards. Rarity sets how many copies it holds, so the
strongest cards turn up least often.

| Card        | Rarity    | Copies | Effect                                                      |
| ----------- | --------- | ------ | ----------------------------------------------------------- |
| Second Wind | Common    | 4      | Reroll your remaining dice                                  |
| Bulwark     | Uncommon  | 3      | Your lone checkers cannot be hit until your next turn       |
| Lucky Charm | Rare      | 2      | Roll one extra die                                          |
| Quake       | Epic      | 1      | Send every lone enemy checker in your home board to the bar |
| Loaded Die  | Legendary | 1      | Your lowest remaining die becomes a 6                       |

You see your opponent's hand face down: how many cards they hold, never which.

A card that would change nothing cannot be played: a second Bulwark while one is up, Quake
with no lone enemy checker in your home board or against a Bulwark, a dice card with no dice
to act on. Trying one keeps it in your hand and tells you why.

Cards are drawn in HTML, CSS and inline SVG as printed card stock (`src/ui/card.ts`,
`src/ui/cardArt.ts`, the card section of `src/style.css`). Each rarity adds to the one below:
a pinstripe, silver edging, violet foil, then gold leaf. Each card is a `Dice` or a `Tactic`
card. How many copies a deck holds is not printed on the card.

Doubles play four times. That also holds when a card leaves you with exactly two matching dice.

## Layout

- `src/core`: rules, cards, seeded RNG, per-player views. No rendering or network imports.
- `src/server`: rooms, lobby API and socket handling, behind a `GameStore` interface (memory
  or Redis). `vercel.ts` is the production entry point; `devPlugin.ts` the local one.
- `src/net`: wire protocol and the client's session (local or remote).
- `src/render`: Three.js scene, board, checkers, effects. Plays back core events.
- `src/app`, `src/ui`: game controller and DOM overlay.
- `tests`: Vitest.

## Deployment

Hosted on Vercel as one project. `pnpm build` produces the client in `dist` and bundles the
game server into `dist-server/vercel.js`, which `api/server.js` exposes as a single Vercel
Function. `vercel.json` routes every `/api/*` request to it and serves the app for `/g/*`.

- Rooms live in Redis (`REDIS_URL`, from a Redis integration on the Vercel project). Without
  it the server falls back to memory, which is only reliable while one instance is running.
- `GET /api/health` reports the store in use and the deployed commit.
- `REDIS_URL=redis://localhost:6379 pnpm test` also runs the Redis store tests.

## Not built yet

- The rule that a roll must be played so as to use as many dice as possible.
- Characters, and any way to start a rematch.
