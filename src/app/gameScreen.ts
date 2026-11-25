import { gsap } from "gsap";

import { sfx } from "../audio/sfx.ts";
import { initialBoard, type Player, pointAt } from "../core/board.ts";
import { CARDS } from "../core/cards.ts";
import { diceToPlay, type GameEvent, legalMoves, possibleMoves } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";
import type { LobbyView } from "../net/protocol.ts";
import type { Session, SessionHandlers, SessionUpdate } from "../net/session.ts";
import type { BoardView } from "../render/board.ts";
import { CheckersView } from "../render/checkers.ts";
import { type DieSlot, DiceView } from "../render/dice.ts";
import { shake, tossAll } from "../render/effects.ts";
import { obstaclesOf, slotPosition } from "../render/layout.ts";
import type { Stage } from "../render/stage.ts";
import type { Coach } from "../ui/coach.ts";
import { IMPACT_AT, prefersLessMotion } from "../ui/gameOver.ts";
import type { Hud } from "../ui/hud.ts";
import { marksFor } from "../ui/marks.ts";
import type { RevealView } from "../ui/reveal.ts";
import type { TableView } from "../ui/table.ts";
import { rollsByItself } from "./autoRoll.ts";
import { createAwayTracker } from "./awayTracker.ts";
import { createCoaching } from "./coaching.ts";
import { playedReveal, revealFor } from "./reveals.ts";

const byValue = (x: number, y: number) => x - y;

/** Whether two sets of dice hold the same values, in any order. */
function sameDice(a: number[], b: number[]): boolean {
  return a.length === b.length && a.toSorted(byValue).join(",") === b.toSorted(byValue).join(",");
}

const COLOR_NAMES = { white: "White", black: "Black" } as const;

const OPENING = JSON.stringify(initialBoard());

/** A game nobody has moved in yet: joining it is the start of the match, not a return to it. */
function untouched(view: PlayerView): boolean {
  return (
    view.wins.white + view.wins.black === 0 &&
    view.phase !== "over" &&
    JSON.stringify(view.board) === OPENING
  );
}

export interface GameScreenDeps {
  stageEl: HTMLElement;
  stage: Stage;
  board: BoardView;
  hud: Hud;
  coach: Coach;
  reveal: RevealView;
  table: TableView;
}

export interface GameScreenOptions {
  /** Hot-seat: both players use this screen, so the camera stays put. */
  local: boolean;
  connect: (handlers: SessionHandlers) => Session;
  /** The room exists but the second player has not joined. */
  onWaiting: (lobby: LobbyView) => void;
  onStarted: () => void;
  /** The session ended for good, for example because the room is gone. */
  onFatal: (message: string) => void;
  /** The player wants to go back to the start screen. */
  onLeave: () => void;
}

/**
 * Where each thrown die should fly to: its face in the HUD. Doubles show four faces for two
 * dice, so each die then lands between the two faces it stands for.
 */
function slotsFor(faces: DOMRect[], count: number): DieSlot[] {
  const per = faces.length === count * 2 ? 2 : 1;
  return Array.from({ length: count }, (_, i) => faces.slice(i * per, i * per + per)).flatMap(
    (group) => {
      const first = group[0];
      const last = group.at(-1);
      if (!first || !last) return [];
      return [
        { x: (first.left + last.right) / 2, y: (first.top + first.bottom) / 2, size: first.height },
      ];
    },
  );
}

/** Milliseconds from a turn's roll coming up to the dice being thrown for the player. */
const AUTO_ROLL_MS = 450;

/** When a revealed card turns up: after the move or throw that set it off has landed. */
const REVEAL_AT = 0.4;
/** Between cards revealed by one update, which line up side by side. */
const REVEAL_STAGGER = 0.25;

const sideOf = (player: Player) => (player === "white" ? 1 : -1);

/** Doubles are four moves but two dice on the table. */
const physical = (values: number[]) =>
  values.length === 4 && values.every((value) => value === values[0]) ? values.slice(0, 2) : values;

/**
 * Drives one game: turns session updates into animation and HUD state, and pointer and key
 * input into commands. Returns a function that tears it all down.
 */
export function runGame(deps: GameScreenDeps, options: GameScreenOptions): () => void {
  const { stageEl, stage, board, hud, coach, reveal, table } = deps;
  const listeners = new AbortController();
  let view: PlayerView | null = null;
  let lobby: LobbyView | null = null;
  let checkers: CheckersView | null = null;
  let selected: number | "bar" | null = null;
  let message = "";
  /** The latest update carried the winning move itself, so the result screen makes an entrance. */
  let justWon = false;
  let offline = false;
  const away = createAwayTracker({
    onBanner: (state) => hud.setOpponentAway(state),
    onOnlineChange: (online) => {
      if (!options.local) hud.setOpponentOnline(online);
    },
    onReconnected: (opponentName) => hud.notify(`${opponentName} reconnected`),
  });
  const coaching = createCoaching(
    { stage, board, coach },
    options.local,
    (shown) => {
      // The card pick waits for the coach, so it must come up now. Otherwise the HUD is left
      // alone: this runs on the very press that dismissed the card, and a redraw would
      // replace the hand card that press is about to click.
      if (shown.phase === "pick") refresh();
      // So does a roll the dice would make by themselves.
      else autoRoll();
    },
    () => rolling,
  );

  const dice = new DiceView(stage.lens, (count) => slotsFor(hud.diceFaces(), count));
  dice.onKnock = (speed) => sfx.dieKnock(speed);
  stage.world.add(dice.group);
  /** The room was waiting for the opponent on this screen, so the game starting is news. */
  let waited = false;
  /**
   * Whether dice are in the air. Set by the throw itself and cleared when its animation
   * reports that it has finished, so the result can never show before the dice have landed,
   * however the animation was delayed.
   */
  let rolling = false;
  /**
   * Until when, by `performance.now()`, a checker a revealed card sent off is still on its
   * way. Moving it sooner would cut its trip short, so the board waits.
   */
  let heldUntil = 0;
  /** The board's shake when the game is won, waiting for the result screen to land. */
  let finale: gsap.core.Tween | null = null;
  /** The throw about to be made for the player, and whether this roll has been asked for. */
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let rollAsked = false;
  const cancelAutoRoll = () => {
    clearTimeout(autoTimer);
    autoTimer = undefined;
  };

  /** Throws the dice for a result the server has already decided, then waits for them. */
  const throwDice = (values: number[], player: Player, state: PlayerView["board"]) => {
    rolling = true;
    sfx.diceThrown();
    dice.throw(physical(values), sideOf(player), obstaclesOf(state), Math.random, () => {
      rolling = false;
      sfx.diceSettled();
      coaching.landed();
      refresh();
    });
  };
  /** Takes the dice away, or notes them as already thrown. Either way nothing is in the air. */
  const settleDice = (values: number[] | null) => {
    rolling = false;
    if (values && values.length > 0) dice.show(physical(values));
    else dice.clear();
  };

  const myTurn = () => view !== null && view.phase !== "over" && view.current === view.you;
  const name = (player: Player) => lobby?.players[player]?.name ?? player;

  /** Redraws everything that depends on the view and the selection. */
  const refresh = () => {
    if (!view || !lobby || !checkers) return;
    // Nothing can be done with a roll until the dice have come to rest.
    const moves = myTurn() && !rolling ? legalMoves(view) : [];
    if (moves.length > 0 && view.board.bar[view.current] > 0) selected = "bar";
    if (!moves.some((m) => m.from === selected)) selected = null;
    const targets = moves.filter((m) => m.from === selected);
    const { board: state, current } = view;
    // A checker lands on top of its own colour, or on the felt of an empty point. When it
    // would hit, it takes the place of the checker that is there now.
    const landing = (point: number) => {
      const there = pointAt(state, point);
      const mine = there.owner === current;
      return {
        point,
        at: slotPosition({ kind: "point", index: point }, mine ? there.count : 0),
        occupied: !mine && there.count > 0,
      };
    };
    const top = (from: number | "bar") =>
      from === "bar"
        ? slotPosition({ kind: "bar", player: current }, state.bar[current] - 1)
        : slotPosition({ kind: "point", index: from }, pointAt(state, from).count - 1);
    const reachable = [
      ...new Set(targets.flatMap((m) => (typeof m.to === "number" ? [m.to] : []))),
    ];
    // Until a checker is picked, show which ones can move at all, and which can leave.
    const movable = selected === null ? [...new Set(moves.map((m) => m.from))] : [];
    const sources = movable.map((from) => ({ from, at: top(from) }));
    board.setHints({
      sources: sources.map((source) => source.at),
      leaving: sources
        .filter(({ from }) => moves.some((m) => m.from === from && m.to === "off"))
        .map((source) => source.at),
      targets: reachable.map(landing),
      off: targets.some((m) => m.to === "off"),
    });
    if (selected === null) checkers.lift(null);
    else if (selected === "bar") checkers.lift({ kind: "bar", player: view.current });
    else checkers.lift({ kind: "point", index: selected });
    hud.render({
      view,
      lobby,
      myTurn: myTurn(),
      canEnd: myTurn() && !rolling && view.phase === "move" && moves.length === 0,
      rolling,
      local: options.local,
      message,
      justWon,
      coaching: coaching.active(),
      opponentOnline: options.local || away.isOnline(),
    });
    autoRoll();
    // What lies on the table in front of each player, for both of them to see.
    table.render(
      (["white", "black"] as const).map((player) => ({
        player,
        owner: !options.local && player === view?.you ? "you" : name(player),
        marks: view ? marksFor(view, player) : [],
      })),
    );
  };

  /** Plays events back as animation and returns the line to show for them, if any. */
  const play = (events: GameEvent[], pieces: CheckersView, next: PlayerView): string => {
    const you = next.you;
    let text = "";
    let quaked = false;
    /** Board events after a revealed card wait until it has turned face up. */
    let after = 0;
    let revealed = 0;
    /** Points where a hit has its own sound, so the hitter's landing there is not heard twice. */
    const struck = new Set<number>();
    const whose = (player: Player) =>
      !options.local && player === you ? "Your" : `${name(player)}'s`;
    const turnUp = (event: GameEvent) => {
      const shown = revealFor(event, whose);
      if (!shown) return 0;
      return reveal.show(shown, REVEAL_AT + REVEAL_STAGGER * revealed++);
    };
    const who = (player: Player) => (!options.local && player === you ? "You" : name(player));
    /** Holds up a card as it is played, at once: nothing on the board waits for it. */
    const holdUp = (event: GameEvent) => {
      const shown = playedReveal(event, who);
      if (shown) reveal.show(shown, REVEAL_STAGGER * revealed++);
    };
    for (const event of events) {
      if (event.type === "pieceMoved") {
        const landing = pieces.apply(event);
        if (event.to === "off") sfx.bearOff(landing.at);
        else if (!struck.has(event.to)) sfx.checkerLands(landing.at, landing.stacked);
      } else if (event.type === "hit") {
        const landing = pieces.apply(event, after);
        const lands = landing.at;
        if (after > 0) heldUntil = Math.max(heldUntil, performance.now() + lands * 1000);
        // The blow lands with the hitter, or as the revealed card that made it turns up.
        struck.add(event.point);
        sfx.hit(after > 0 ? after : 0.4, lands);
        // A quake already shook the board; a second shake would cut it short. A hit a
        // revealed card made shook the board as the card turned up.
        if (!quaked && after === 0) shake(stage.world, 0.6, 0.4);
      } else if (event.type === "cardPlayed") {
        holdUp(event);
        text = `${name(event.player)} played ${CARDS[event.card].name}`;
        sfx.cardPlayed();
        if (event.card === "quake") {
          quaked = true;
          shake(stage.world, 1.4);
          tossAll(pieces.all());
          sfx.boardThump(1.4);
          sfx.clatter(1);
        }
      } else if (event.type === "shieldRaised") {
        sfx.shield();
      } else if (event.type === "hexCast") {
        sfx.hexCast();
        text = `${name(event.player)} is hexed: ${CARDS[event.card].name}`;
      } else if (event.type === "hexWarded") {
        const ward = `${name(event.player)}'s ${CARDS[event.ward].name}`;
        const hex = CARDS[event.card].name;
        text = event.ward === "mirror" ? `${ward} throws ${hex} back` : `${ward} blocks ${hex}`;
        sfx.hexWarded();
      } else if (event.type === "hexStruck") {
        sfx.hexStruck(turnUp(event));
        text =
          event.card === "backstep"
            ? `Backstep: ${name(event.player)}'s next move goes backwards`
            : `${CARDS[event.card].name} bites ${name(event.player)}'s roll`;
      } else if (event.type === "hexLifted") {
        const freed = event.cards.map((card) => CARDS[card].name).join(" and ");
        text = `${name(event.player)} is free of ${freed}`;
        sfx.hexLifted();
      } else if (event.type === "trapSet") {
        sfx.trapSet();
        // In pass-and-play the other player is about to take the device: the trap stays secret.
        const set = options.local ? { ...event, card: null } : event;
        holdUp(set);
        text = set.card
          ? `${name(set.player)} set ${CARDS[set.card].name}, face down`
          : `${name(set.player)} set a trap`;
      } else if (event.type === "trapSprung") {
        text = `${name(event.player)}'s ${CARDS[event.card].name} springs!`;
        after = turnUp(event);
        shake(stage.world, 0.5, after);
        sfx.trapSprung(after);
      } else if (event.type === "coinFlipped") {
        text += event.heads ? ": heads!" : ": tails";
        sfx.coin(event.heads);
      } else if (event.type === "diceRolled") {
        throwDice(event.dice, event.player, next.board);
      } else if (event.type === "diceChanged") {
        // A card changed the dice: throw them again, landing on the new values.
        throwDice(event.dice, event.player, next.board);
        if (event.doubled && text) text += ": doubles!";
      } else if (event.type === "turnEnded") {
        settleDice(null);
        // Online, the wait is over: the player may have looked away.
        if (!options.local && event.next === you) sfx.yourTurn();
        else sfx.turnEnded();
      } else if (event.type === "cardsOffered" && event.cards) {
        sfx.cardsDealt(event.cards.length);
      } else if (event.type === "cardPicked") {
        sfx.cardFlick();
        if (event.player !== you) text = `${name(event.player)} picked a card`;
      } else if (event.type === "rematchOffered" && event.player !== you) {
        sfx.rematchOffered();
      } else if (event.type === "gameWon") {
        const victory = options.local || event.winner === you;
        sfx.result(victory, prefersLessMotion() ? 0.15 : IMPACT_AT);
        // The board takes the blow when the result screen's crest strikes down.
        finale?.kill();
        if (!prefersLessMotion()) {
          finale = gsap.delayedCall(IMPACT_AT, () => {
            shake(stage.world, 1.8);
            tossAll(pieces.all(), 1.8);
          });
        }
      } else if (event.type === "gameStarted") {
        // A rematch: everything goes back to the starting position.
        finale?.kill();
        reveal.clear();
        pieces.reset(next.board);
        settleDice(null);
        sfx.matchStarted();
        text = `New game: ${name(event.first)} starts`;
      }
    }
    return text;
  };

  const onUpdate = (update: SessionUpdate) => {
    lobby = update.lobby;
    if (!update.view) {
      waited = true;
      options.onWaiting(update.lobby);
      return;
    }
    const starting = !view;
    // The opponent sitting down, or a fresh game begun here; not a return to one under way.
    if (starting && (waited || update.events.length > 0 || untouched(update.view))) {
      sfx.matchStarted();
    }
    // A game that was over and now is not has been replaced by a rematch, even when the
    // update is a snapshot without the rematch's events, as after a reconnect.
    const rematched =
      (view?.phase === "over" && update.view.phase !== "over") ||
      update.events.some((event) => event.type === "gameStarted");
    if (starting) {
      options.onStarted();
      if (!options.local) stage.setSeat(update.view.you);
    }
    message = "";
    justWon = update.events.some((event) => event.type === "gameWon");
    if (checkers) {
      message = play(update.events, checkers, update.view);
    } else {
      checkers = new CheckersView(update.view.board);
      stage.world.add(checkers.group);
    }
    // Dice belong to the move phase. An update without events is a snapshot: a reload, a
    // reconnect or a resync after something was missed. The dice on the board may then be
    // missing or out of date, so they are set down to match what the snapshot says is left.
    const { phase, dice: remaining } = update.view;
    const snapshot = update.events.length === 0;
    if (phase !== "move") settleDice(null);
    else if (snapshot && (rolling || !sameDice(dice.values, physical(remaining)))) {
      // Also when a throw is still in the air: a snapshot carries no throw to wait for.
      settleDice(remaining);
    }
    if (starting && !options.local) message = `You are playing ${COLOR_NAMES[update.view.you]}`;
    // Missed or unexpected events: snap to the truth instead of drifting.
    if (!checkers.matches(update.view.board)) checkers.reset(update.view.board);
    // A pass-and-play handover: a card the last player was studying up close goes away.
    if (options.local && view && view.current !== update.view.current) table.dismiss();
    // A roll that has come and gone may be thrown for the player again next time.
    if (update.view.phase !== "roll") rollAsked = false;
    coaching.update(view, update.view, starting || rematched);
    view = update.view;
    selected = null;
    refresh();
    const other: Player = update.view.you === "white" ? "black" : "white";
    away.setGame(!options.local && update.view.phase !== "over", name(other));
  };

  const session = options.connect({
    onUpdate,
    onPresence: (presence) => {
      if (!options.local) away.onPresence(presence);
    },
    onError(text, fatal) {
      if (fatal) return options.onFatal(text);
      away.onClaimError();
      // Whatever was asked was refused: the roll may be asked for again, by hand.
      rollAsked = false;
      sfx.denied();
      // The server said no. Shown as a notice, so it is seen whatever else is on screen.
      hud.notify(text);
    },
    onStatus(next) {
      // Losing the server is said loudly and at once; so is getting it back.
      const lost = next === "reconnecting";
      if (lost === offline) return;
      offline = lost;
      hud.setOffline(offline);
      if (!offline) hud.notify("Back online");
      // No throw is made into a dead connection; once back, the roll is looked at afresh,
      // as a reconnect that missed nothing brings no update to do it. A roll asked for as
      // the line went may never have arrived, and no answer will come for it: ask again.
      // If it did arrive, the reconnect brings the roll itself, and nothing is asked twice.
      if (offline) {
        cancelAutoRoll();
        rollAsked = false;
      } else autoRoll();
    },
  });

  /** Asks for the roll once, whether by hand or by itself, until the server answers. */
  const roll = () => {
    if (rollAsked || !myTurn() || view?.phase !== "roll") return;
    rollAsked = true;
    cancelAutoRoll();
    session.send({ type: "roll" });
  };
  /**
   * Nothing is decided before the roll unless a card can be played first, so the dice are
   * thrown for the player a moment after their roll comes up. Not while a guide is up.
   */
  function autoRoll() {
    if (autoTimer !== undefined || rollAsked || offline || !view || coaching.active()) return;
    if (!rollsByItself(view)) return;
    autoTimer = setTimeout(() => {
      autoTimer = undefined;
      if (offline || !view || coaching.active() || !rollsByItself(view)) return;
      roll();
    }, AUTO_ROLL_MS);
  }
  const end = () => {
    if (myTurn() && !rolling && view?.phase === "move") session.send({ type: "endTurn" });
  };
  hud.actions = {
    onRoll: roll,
    onEnd: end,
    onPlay: (index) => {
      if (!rolling) session.send({ type: "playCard", index });
    },
    onBlocked: (reason) => {
      sfx.denied();
      hud.notify(reason);
    },
    onPick: (index) => session.send({ type: "pickCard", index }),
    onClaimVictory: () => {
      if (!options.local && away.beginClaim(offline)) session.send({ type: "claimVictory" });
    },
    onRematch: () => {
      if (view?.phase === "over") session.send({ type: "rematch" });
    },
    onLeave: options.onLeave,
  };

  stageEl.addEventListener(
    "pointerdown",
    (event) => {
      if (!view || !myTurn() || view.phase !== "move") return;
      if (rolling || performance.now() < heldUntil) return;
      const target = stage.pick(event.clientX, event.clientY);
      const moves = legalMoves(view);

      if (selected !== null && target && target.kind !== "bar") {
        const to = target.kind === "point" ? target.index : "off";
        // With several dice reaching the same spot, spend the smallest.
        const [move] = moves
          .filter((m) => m.from === selected && m.to === to)
          .toSorted((a, b) => a.die - b.die);
        if (move) {
          session.send({ type: "move", from: move.from, to: move.to, die: move.die });
          selected = null;
          refresh();
          return;
        }
      }
      selected = target?.kind === "point" ? target.index : null;
      // Picking a checker that can move, not just any point, is acting on the lesson.
      if (selected !== null && moves.some((m) => m.from === selected)) {
        coaching.picked();
        sfx.select();
      }
      // A move a die allows but the rules do not: say why, or it just looks broken.
      const from = selected ?? (view.board.bar[view.current] > 0 ? "bar" : null);
      if (
        from !== null &&
        !moves.some((m) => m.from === from) &&
        possibleMoves(view).some((m) => m.from === from)
      ) {
        sfx.denied();
        hud.notify(
          diceToPlay(view) === 1
            ? "You must play the higher die when only one can be played"
            : "You must use as many dice as you can; moving that checker first would waste one",
        );
      }
      refresh();
    },
    { signal: listeners.signal },
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat || event.target instanceof HTMLInputElement) return;
      // A focused button keeps its own keys: Space and Enter press it, as on any page.
      // Without this, Space on a focused card would roll instead of picking or playing it.
      const onButton = event.target instanceof HTMLButtonElement && !event.target.disabled;
      if (event.code === "Space" && onButton) return;
      if (event.code === "Space") {
        event.preventDefault();
        roll();
      } else if (event.code === "KeyE") {
        end();
      } else if (event.code === "KeyD" && import.meta.env.DEV) {
        // Development only: fake a dropped connection.
        session.drop();
      }
    },
    { signal: listeners.signal },
  );

  return () => {
    cancelAutoRoll();
    away.stop();
    coaching.stop();
    finale?.kill();
    reveal.clear();
    table.clear();
    session.close();
    listeners.abort();
    hud.actions = null;
    hud.setOffline(false);
    hud.setOpponentAway(null);
    board.setHints();
    if (checkers) stage.world.remove(checkers.group);
    settleDice(null);
    stage.world.remove(dice.group);
    stage.setSeat("white");
  };
}
