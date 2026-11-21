import {
  applyMove,
  type BoardEvent,
  type BoardState,
  cloneBoard,
  legalMovesForDie,
  loneEnemiesAtHome,
  opponent,
  type Player,
  quietStep,
  sweepHome,
} from "./board.ts";
import {
  CARDS,
  type CardId,
  type HexId,
  isHex,
  isTrap,
  TRAP_LIMIT,
  type TrapId,
  type WardId,
} from "./cards.ts";
import { createRng, rollDie } from "./rng.ts";
import {
  asDoubles,
  type CardTurn,
  cloneCards,
  type GameEvent,
  GameError,
  type GameState,
  lowerHighest,
  type Result,
  withPlayer,
} from "./state.ts";

function sorted(dice: number[]): string {
  return dice.toSorted((a, b) => a - b).join(",");
}

const flipped = (dice: number[]) => dice.map((die) => 7 - die);

/** Whether a hex is on the player, waiting or (Backstep) biting now. */
function hexed(turn: CardTurn, player: Player): boolean {
  return turn.hexes[player].length > 0 || (turn.reversing && turn.current === player);
}

/**
 * Why a card cannot be played right now, in words for the player, or `null` if it can.
 * A card that would change nothing is not playable: it would be thrown away for no effect.
 * Everything this looks at is public, apart from `traps`, the player's own set traps, so a
 * client can ask the same question as the server.
 */
export function cardBlock(turn: CardTurn, card: CardId, traps: readonly TrapId[]): string | null {
  const me = turn.current;
  const them = opponent(me);
  const { name } = CARDS[card];

  // Lifting a hex may come before the roll, while the hex still waits to bite.
  if (card === "sageSmoke" || card === "curseEater") {
    if (turn.phase !== "roll" && turn.phase !== "move") return "Pick a card first";
    if (hexed(turn, me)) return null;
    if (card === "curseEater") return "Curse Eater needs a hex on you to lift";
    if (turn.phase === "roll") return "No hex to lift. After rolling, Sage Smoke rerolls a die";
    return turn.dice.length > 0 ? null : "Sage Smoke needs a hex to lift or a die to reroll";
  }
  if (turn.phase !== "move") return "Roll before playing a card";
  if (isHex(card)) return turn.hexes[them].includes(card) ? `They are already under ${name}` : null;
  if (isTrap(card)) {
    if (traps.includes(card)) return `You already have ${name} set`;
    return traps.length >= TRAP_LIMIT ? `You can have only ${TRAP_LIMIT} traps set at once` : null;
  }

  switch (card) {
    case "reroll":
      return turn.dice.length > 0 ? null : "Second Wind needs dice left to reroll";
    case "loaded":
      if (turn.dice.length === 0) return "Loaded Die needs a die left to change";
      return turn.dice.some((die) => die < 6) ? null : "Every die you have left is already a 6";
    case "charm":
      return null;
    case "shield":
      return turn.shielded[me] ? "Bulwark is already protecting your checkers" : null;
    case "quake":
      if (turn.shielded[them]) return "Their Bulwark protects their checkers from Quake";
      return loneEnemiesAtHome(turn.board, me).length > 0
        ? null
        : "Quake would do nothing: no lone enemy checker is in your home board";
    case "horseshoe":
    case "mirror":
      return turn.wards[me].includes(card) ? `Your ${name} is already standing` : null;
    case "chisel":
      if (turn.dice.length === 0) return "Chisel needs a die left to split";
      return Math.max(...turn.dice) > 1 ? null : "Chisel cannot split a 1";
    case "quietStep":
      if (turn.board.bar[me] > 0) return "Enter your checkers from the bar first";
      if (turn.reversing) return "Backstep first: your next checker move must go backwards";
      return quietStep(turn.board, me)
        ? null
        : "Quiet Step has no room: your rearmost checker cannot step forward";
    case "keenEye":
      return turn.extraOffer[me] ? "Keen Eye is already on your next pick" : null;
    case "coinToss":
      return turn.dice.length > 0 ? null : "Coin Toss needs a die left to stake";
    case "flipBones":
      if (turn.dice.length === 0) return "Flip the Bones needs dice left to flip";
      return sorted(flipped(turn.dice)) === sorted(turn.dice)
        ? "Flipping these dice would change nothing"
        : null;
  }
}

/** Moves a sprung trap from the table to its owner's discard pile, revealing it. */
function spring(next: GameState, owner: Player, trap: TrapId, events: GameEvent[]): void {
  next.traps = withPlayer(
    next.traps,
    owner,
    next.traps[owner].filter((set) => set !== trap),
  );
  const cards = cloneCards(next.cards[owner]);
  cards.discard.push(trap);
  next.cards = withPlayer(next.cards, owner, cards);
  events.push({ type: "trapSprung", player: owner, card: trap });
}

/**
 * Sets the player on turn's dice, making an exact pair doubles. Doubles spring the
 * opponent's Loose Board, which takes one of the four. Returns whether doubles were made.
 * `next` is a copy the caller owns; only its top-level fields are replaced.
 */
export function settleDice(next: GameState, dice: number[], events: GameEvent[]): boolean {
  const four = asDoubles(dice);
  next.dice = four;
  if (four === dice) return false;
  const them = opponent(next.current);
  if (next.traps[them].includes("looseBoard")) {
    spring(next, them, "looseBoard", events);
    next.dice = four.slice(1);
  }
  return true;
}

function liftHexes(next: GameState, player: Player, cards: HexId[], events: GameEvent[]): void {
  if (cards.length === 0) return;
  next.hexes = withPlayer(
    next.hexes,
    player,
    next.hexes[player].filter((hex) => !cards.includes(hex)),
  );
  events.push({ type: "hexLifted", player, cards });
}

/** Hitting one of the opponent's checkers breaks the Shackles of Greed on the player on turn. */
export function breakShackles(next: GameState, hits: BoardEvent[], events: GameEvent[]): void {
  const me = next.current;
  const them = opponent(me);
  if (!hits.some((event) => event.type === "hit" && event.player === them)) return;
  if (next.hexes[me].includes("shackles")) liftHexes(next, me, ["shackles"], events);
}

/**
 * A checker move just hit at `point`: springs the victim's Counterpunch, sending the
 * hitting checker to the bar as well, unless the hitter is shielded.
 */
export function counterpunch(next: GameState, point: number, events: GameEvent[]): void {
  const me = next.current;
  const them = opponent(me);
  if (!next.traps[them].includes("counterpunch") || next.shielded[me]) return;
  const board = cloneBoard(next.board);
  const target = board.points[point];
  if (!target || target.owner !== me) return;
  target.count -= 1;
  if (target.count === 0) target.owner = null;
  board.bar[me] += 1;
  // With both players on the bar and both home boards shut, neither could ever move
  // again. The trap holds rather than end the game in a lock.
  if (shutOut(board, me) && shutOut(board, them)) return;
  spring(next, them, "counterpunch", events);
  next.board = board;
  events.push({ type: "hit", player: me, point });
  // Sending the caster to the bar is hitting them: it breaks the defender's Shackles.
  if (next.hexes[them].includes("shackles")) liftHexes(next, them, ["shackles"], events);
}

/** Whether the player has checkers on the bar and no die could bring one in. */
function shutOut(board: BoardState, player: Player): boolean {
  if (board.bar[player] === 0) return false;
  return [1, 2, 3, 4, 5, 6].every((die) => legalMovesForDie(board, player, die).length === 0);
}

/**
 * Rolls for the player on turn, then lets the hexes on them bite: Cracked Dice rolls three
 * and drops the highest; Shackles and Lead Weight each lower a highest die, though natural
 * doubles break Shackles instead; Backstep turns their first move around. Then the dice
 * Curse Eater promised are added. Every hex but unbroken Shackles is spent.
 */
export function rollDice(state: GameState): Result {
  const player = state.current;
  const rng = createRng(state.rng);
  const hexes = state.hexes[player];
  const next: GameState = { ...state, phase: "move" };
  const events: GameEvent[] = [];
  const struck = (card: HexId) => events.push({ type: "hexStruck", player, card });

  let doubles = false;
  let shown: number[];
  if (hexes.includes("crackedDice")) {
    shown = [rollDie(rng), rollDie(rng), rollDie(rng)];
    events.push({ type: "diceRolled", player, dice: shown });
    struck("crackedDice");
    next.dice = shown.toSorted((a, b) => a - b).slice(0, 2);
  } else {
    const pair = [rollDie(rng), rollDie(rng)];
    shown = asDoubles(pair);
    events.push({ type: "diceRolled", player, dice: shown });
    doubles = settleDice(next, pair, events);
  }

  let kept = hexes.filter((hex) => hex === "shackles");
  if (hexes.includes("shackles")) {
    if (doubles) {
      kept = [];
      events.push({ type: "hexLifted", player, cards: ["shackles"] });
    } else {
      struck("shackles");
      next.dice = lowerHighest(next.dice);
    }
  }
  if (hexes.includes("leadWeight")) {
    struck("leadWeight");
    next.dice = lowerHighest(next.dice);
  }
  if (hexes.includes("backstep")) {
    struck("backstep");
    next.reversing = true;
  }
  const bonus = state.bonusDice[player];
  if (bonus > 0) next.dice = [...next.dice, ...Array.from({ length: bonus }, () => rollDie(rng))];

  if (sorted(next.dice) !== sorted(shown)) {
    events.push({ type: "diceChanged", player, dice: next.dice, doubled: false });
  }
  next.hexes = withPlayer(state.hexes, player, kept);
  next.bonusDice = withPlayer(state.bonusDice, player, 0);
  next.rng = rng.state;
  return { state: next, events };
}

function useWard(next: GameState, player: Player, ward: WardId, hex: HexId, events: GameEvent[]) {
  next.wards = withPlayer(
    next.wards,
    player,
    next.wards[player].filter((standing) => standing !== ward),
  );
  events.push({ type: "hexWarded", player, card: hex, ward });
}

/**
 * Casts a hex at the caster's opponent. A mirror sends it back to the caster, where only a
 * horseshoe can stop it: mirrors do not volley. A horseshoe blocks it outright.
 */
function castHex(next: GameState, hex: HexId, events: GameEvent[]): void {
  const caster = next.current;
  let target = opponent(caster);
  if (next.wards[target].includes("mirror")) {
    useWard(next, target, "mirror", hex, events);
    target = caster;
  }
  if (next.wards[target].includes("horseshoe")) {
    useWard(next, target, "horseshoe", hex, events);
    return;
  }
  // A hex rebounding onto a caster already under it has nothing to add.
  if (next.hexes[target].includes(hex)) return;
  next.hexes = withPlayer(next.hexes, target, [...next.hexes[target], hex]);
  events.push({ type: "hexCast", player: target, card: hex });
}

export function playCard(state: GameState, index: number): Result {
  const player = state.current;
  const mine = cloneCards(state.cards[player]);
  const card = mine.hand[index];
  if (card === undefined) throw new GameError("No such card in hand");
  const blocked = cardBlock(state, card, state.traps[player]);
  if (blocked) throw new GameError(blocked);
  mine.hand.splice(index, 1);

  const rng = createRng(state.rng);
  const next: GameState = { ...state };
  const events: GameEvent[] = [];

  if (isTrap(card)) {
    // Set face down: it reaches the discard pile only once it springs.
    next.cards = withPlayer(state.cards, player, mine);
    next.traps = withPlayer(state.traps, player, [...state.traps[player], card]);
    events.push({ type: "trapSet", player, card });
    return { state: next, events };
  }
  mine.discard.push(card);
  next.cards = withPlayer(state.cards, player, mine);
  events.push({ type: "cardPlayed", player, card });

  /** New dice, and whether an exact pair among them makes doubles. */
  let dice: { values: number[]; pairs: boolean } | null = null;
  const lowest = () => state.dice.indexOf(Math.min(...state.dice));

  if (isHex(card)) {
    castHex(next, card, events);
  } else if (card === "reroll") {
    dice = { values: state.dice.map(() => rollDie(rng)), pairs: true };
  } else if (card === "loaded") {
    const values = [...state.dice];
    values[values.indexOf(Math.min(...values))] = 6;
    dice = { values, pairs: true };
  } else if (card === "charm") {
    dice = { values: [...state.dice, rollDie(rng)], pairs: true };
  } else if (card === "shield") {
    next.shielded = withPlayer(state.shielded, player, true);
    events.push({ type: "shieldRaised", player });
  } else if (card === "quake") {
    const swept = sweepHome(state.board, player);
    next.board = swept.board;
    events.push(...swept.events);
    breakShackles(next, swept.events, events);
  } else if (card === "horseshoe" || card === "mirror") {
    next.wards = withPlayer(state.wards, player, [...state.wards[player], card]);
  } else if (card === "sageSmoke" || card === "curseEater") {
    // A Backstep biting now is lifted apart from the hexes still waiting, which may include
    // another Backstep that rebounded this turn.
    const waiting = state.hexes[player];
    const biting = state.reversing ? 1 : 0;
    const liftBiting = () => {
      next.reversing = false;
      events.push({ type: "hexLifted", player, cards: ["backstep"] });
    };
    if (card === "curseEater") {
      if (biting) liftBiting();
      liftHexes(next, player, [...waiting], events);
      const eaten = biting + waiting.length;
      if (state.phase === "roll") {
        next.bonusDice = withPlayer(state.bonusDice, player, state.bonusDice[player] + eaten);
      } else {
        const extra = Array.from({ length: eaten }, () => rollDie(rng));
        dice = { values: [...state.dice, ...extra], pairs: true };
      }
    } else if (biting) {
      liftBiting();
    } else if (waiting.length > 0) {
      liftHexes(next, player, waiting.slice(0, 1), events);
    } else {
      const values = [...state.dice];
      values[lowest()] = rollDie(rng);
      dice = { values, pairs: true };
    }
  } else if (card === "chisel") {
    const values = [...state.dice];
    const high = Math.max(...values);
    values.splice(values.indexOf(high), 1, Math.ceil(high / 2), Math.floor(high / 2));
    dice = { values, pairs: false };
  } else if (card === "quietStep") {
    const step = quietStep(state.board, player);
    if (step) {
      const moved = applyMove(state.board, { player, ...step, die: 1 });
      next.board = moved.board;
      events.push(...moved.events);
    }
  } else if (card === "keenEye") {
    next.extraOffer = withPlayer(state.extraOffer, player, true);
  } else if (card === "coinToss") {
    const heads = rng.int(2) === 0;
    events.push({ type: "coinFlipped", player, heads });
    if (heads) {
      dice = { values: [...state.dice, rollDie(rng)], pairs: true };
    } else {
      const values = [...state.dice];
      values.splice(lowest(), 1);
      dice = { values, pairs: false };
    }
  } else {
    // Flip the Bones: the same number of dice: two flipped 1s become two 6s, not four.
    dice = { values: flipped(state.dice), pairs: false };
  }

  if (dice) {
    const doubled = dice.pairs ? settleDice(next, dice.values, events) : false;
    if (!dice.pairs) next.dice = dice.values;
    events.push({ type: "diceChanged", player, dice: next.dice, doubled });
  }
  next.rng = rng.state;
  return { state: next, events };
}
