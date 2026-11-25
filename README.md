# Backgammon Rogue-like

Backgammon with cards, played against a friend or a stranger. Three.js + TypeScript + Vite.

- [ADR 0001](docs/adr/0001-engine-and-stack.md): engine and stack
- [ADR 0002](docs/adr/0002-multiplayer-architecture.md): multiplayer architecture
- [Design notes](docs/design.md): how screens should look and behave, and how to check them

## Commands

- `pnpm dev`: the whole game, server included, with hot reload
- `pnpm dev --host`: same, reachable from other devices on your network
- `pnpm gate`: lint, format check, typecheck, tests, build
- `pnpm fix`: apply oxlint fixes, then format with oxfmt

A pre-commit hook (installed by `pnpm install`) runs `oxlint --fix` and `oxfmt` on staged
files. Lint rules live in `.oxlintrc.json`; type-aware rules run via `oxlint-tsgolint`.
CI (`.github/workflows/ci.yml`) runs the same checks on every PR and push to `main`, with
a Redis service so the Redis store tests run too.

## Playing locally

Run `pnpm dev` and open the printed URL. Start a game in one tab, then open a second tab and
enter the code (or paste the invite link). Each tab is its own player with its own hidden hand.

"Play both sides on this device" runs a hot-seat game with no server. Append `?seed=123` to
replay the same shuffles and dice.

Keys: `Space` rolls, `E` ends the turn, `M` turns sound on or off (remembered per browser). In development, `D` drops the connection to exercise
reconnecting. Rooms live in memory and are lost when the dev server restarts.

## Playing a stranger

"Play online" on the start screen looks for anyone else who is looking. The first two
seekers are seated together at once, in a new room, with whoever waited longer as White.
There is no rating or region: it is first come, first served.

To try it locally, choose "Play online" in two tabs. A seeker who cancels, closes the tab,
or whose browser stops asking for about five seconds is never matched.

## How to play page

"How to play" under the start menu explains plain backgammon, what the cards add, and lists
every card grouped by kind. Its words live in `src/ui/lobby/rulesCopy.ts`; each card's line
is its own rules text from `src/core/cards.ts`, so a card change shows up there by itself.

## Sound

Every sound is synthesised at play time with Web Audio (`src/audio/`); there are no audio
files. `engine.ts` holds the context, master bus, room reverb and building blocks;
`sfx.ts` has one recipe per game moment. Dice knocks come from the dice simulation itself
(`DiceThrow.knocks`), so each clack lines up with a die striking something on screen.

## How a turn works

1. Pick one of three cards offered from your deck (skipped when your hand holds five).
2. Roll. The dice are thrown for you a moment after the pick, unless you hold a card that
   can be played before rolling (a cleansing ward while a hex waits on you); then press Roll.
3. Move checkers and play cards from your hand, in any order.
4. End the turn once no checker move is left.

A roll must be played so as to use as many dice as possible. If only one die can be played,
it must be the higher one when either could be. Checkers that would waste a die are not
offered as moves; clicking one says why.

On a touch screen, the first tap on a hand card raises it so it can be read, and the second
plays it. Tap anywhere else to put it back.

Guides explain the goal as a game starts and bearing off once every checker is home. Any
press closes one; "Don't show guides again" turns them off for good (kept in
`localStorage`), and the How to play page turns them back on.

## Characters

Each player picks a character on the start screen. It is shown as a medallion next to their
name. Characters are cosmetic for now: they change nothing about the rules.

## Rematch

When a game ends, both players are offered a rematch. The new game starts once both have
asked, with the same seats and colours, freshly shuffled decks and a random first player.
The score of the match is kept and shown next to each name. In hot-seat play one press of
"Play again" is enough. "Leave game" goes back to the start screen.

## Dice

The dice are physical objects on the board. A roll throws them from the roller's edge; they
bounce off the felt, the rims, the checkers and each other. The server decides the result
before the throw: the client simulates the throw, then paints each die so that the face it
lands on shows the server's value. Cards that change the dice throw them again.

## Cards

Each player has their own deck of 54 cards. Rarity sets how many copies it holds (common 4,
uncommon 3, rare 2, epic and legendary 1), so the strongest cards turn up least often.

| Card              | Kind   | Rarity    | Effect                                                                      |
| ----------------- | ------ | --------- | --------------------------------------------------------------------------- |
| Second Wind       | Dice   | Common    | Reroll your remaining dice                                                  |
| Chisel            | Dice   | Common    | Split your highest die into two that add up to it; never doubles            |
| Lead Weight       | Curse  | Common    | Their next roll: the highest die drops by 1                                 |
| Iron Horseshoe    | Ward   | Common    | Blocks the next hex cast on you                                             |
| Sage Smoke        | Ward   | Common    | Before or after rolling: lift one hex; if none, reroll your lowest die      |
| Quiet Step        | Tactic | Common    | Your rearmost checker steps 1 point forward, using no die and never hitting |
| Loose Board       | Trap   | Common    | When they get doubles, one of the four dice is lost                         |
| Keen Eye          | Tempo  | Common    | Your next pick offers four cards                                            |
| Coin Toss         | Wild   | Common    | Heads: an extra die. Tails: lose your lowest die                            |
| Bulwark           | Tactic | Uncommon  | Your lone checkers cannot be hit until your next turn                       |
| Lucky Charm       | Dice   | Rare      | Roll one extra die                                                          |
| Backstep          | Curse  | Rare      | Next turn, their first checker move goes backwards if it can                |
| Flip the Bones    | Dice   | Rare      | Turn each die over (1 for 6, 2 for 5, 3 for 4); never doubles               |
| Glass Mirror      | Ward   | Rare      | The next hex cast on you rebounds onto the caster                           |
| Counterpunch      | Trap   | Rare      | When they hit your checker, their hitter goes to the bar too                |
| Quake             | Tactic | Epic      | Send every lone enemy checker in your home board to the bar                 |
| Cracked Dice      | Curse  | Epic      | Their next roll is three dice with the highest dropped; never doubles       |
| Curse Eater       | Ward   | Epic      | Before or after rolling: lift every hex on you and roll a die for each      |
| Loaded Die        | Dice   | Legendary | Your lowest remaining die becomes a 6                                       |
| Shackles of Greed | Curse  | Legendary | Their highest die drops by 1 every roll, until they hit you or roll doubles |

The fifteen added with curses were picked by a council of models from a pool of 54
candidates, judged on how fun they are to play with and against.

**Curses** (hexes) land on the opponent and bite when they next roll. All but Shackles are
spent then. **Wards** answer them: Iron Horseshoe and Glass Mirror stand on the table in
plain sight and wait for the next hex. A mirrored hex lands on its caster, where only a
horseshoe can stop it, because mirrors do not volley. Sage Smoke and Curse Eater lift hexes
and may be played before rolling, while a hex still waits. **Traps** are set face down: the
opponent sees that one is set, never which, until it springs. A player may have two set, of
different kinds. Counterpunch holds rather than spring when it would leave both players
shut out on the bar for good.

Whatever lies in front of a player is shown as cards on the table at their edge of the board
(`src/ui/table.ts`): hexes on them, wards and boons face up, traps face down. Each is rimmed
in its kind's ink: hexes violet, wards silver, traps rust, boons gold. Pressing one shows it
up close with what it does; your own face-down trap shows its face to you alone.

Every card played is held up over the board for both players for a moment; a trap being
set is shown face down to the opponent.

You see your opponent's hand face down: how many cards they hold, never which.

A card that would change nothing cannot be played: a second Bulwark while one is up, Quake
with no lone enemy checker in your home board or against a Bulwark, a dice card with no dice
to act on, a hex the opponent is already under. Trying one keeps it in your hand and tells
you why.

Cards are drawn in HTML, CSS and inline SVG as printed card stock (`src/ui/card.ts`,
`src/ui/cardArt.ts`, `src/ui/cardArtTavern.ts`, the card section of `src/style.css`). Each
rarity adds to the one below: a pinstripe, silver edging, violet foil, then gold leaf. How
many copies a deck holds is not printed on the card.

Doubles play four times. That also holds when a card leaves you with exactly two matching
dice, except where the card says "never doubles".

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
- Vercel ends every connection when its function reaches its maximum duration (300 s, set in
  `vercel.json`). The client replaces its socket after 240 s, before that happens, and takes
  over the new one only once it has the current state, so play is not interrupted. Every
  command carries an id that the server acknowledges, and the old socket is kept until
  everything sent on it has been answered, so nothing in flight is lost. It also
  pings every 20 s to notice a dead connection, and shows a banner while it is reconnecting.
- `REDIS_URL=redis://localhost:6379 pnpm test` also runs the Redis store tests.
