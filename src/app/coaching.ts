import { allHome, isHome, type Player, POINT_COUNT, pointAt, untouched } from "../core/board.ts";
import { legalMoves } from "../core/game.ts";
import type { PlayerView } from "../core/view.ts";
import type { BoardView } from "../render/board.ts";
import type { Guide } from "../render/guide.ts";
import {
  type Area,
  backArea,
  CHECKER_H,
  CHECKER_R,
  FIELD_HALF_W,
  homeArea,
  OUTER_D,
  outerArea,
  RIM,
  ROUTE_LANE,
  slotPosition,
  TRAY_W,
  TRAY_X,
  trayWell,
} from "../render/layout.ts";
import type { Stage } from "../render/stage.ts";
import type { Coach } from "../ui/coach.ts";
import { prefersLessMotion } from "../ui/gameOver.ts";
import { type Lesson, lessonText, nextLesson, type Progress, startProgress } from "./guidance.ts";

/** The part of the board a lesson is about: home, or home and the tray beside it. */
function lessonArea(lesson: Lesson): Area {
  const home = homeArea(lesson.player);
  if (lesson.kind === "home") return home;
  const tray = trayWell(lesson.player);
  return {
    x0: home.x0,
    x1: tray.x1,
    z0: Math.min(home.z0, tray.z0),
    z1: Math.max(home.z1, tray.z1),
  };
}

/** The column the route sets out along: from the back checkers to the middle of the board. */
function routeStart(player: Player): Area {
  const back = backArea(player);
  return { x0: back.x0, x1: back.x1, z0: Math.min(back.z0, 0), z1: Math.max(back.z1, 0) };
}

/** How far past a stack's innermost checker a bear-off route keeps clear of it. */
const CLEAR = 0.65;
/** How far a bear-off route runs out from its stack before turning for the tray. */
const HOP = 1;
/** The nearest the bear-off route comes to the middle of the board: inside the own well. */
const OWN_WELL = 0.35;

/** Where a bear-off route starts and crosses, and the dice that carry a checker off there. */
interface Leaving {
  from: { x: number; out: number; cross: number };
  dice: number[];
  /** How many triangles from the tray the source stands: 1 is the nearest. */
  distance: number;
}

/**
 * Seconds each lesson stays up unless dismissed. The first waits for the player, who must
 * act to start anyway; the second comes mid-turn, so it goes by itself.
 */
const HOLD = { home: null, bearOff: 16 } as const;

/**
 * The whole board, rails and tray included, with a little more along each long edge for
 * the rails' height and the shadow under them, which reach past their outline on the felt.
 */
const WHOLE_BOARD: Area = {
  x0: -FIELD_HALF_W - RIM,
  x1: TRAY_X + TRAY_W / 2,
  z0: -OUTER_D / 2 - 0.4,
  z1: OUTER_D / 2 + 0.4,
};
/** How far beyond the tray's outer wall the bear-off tag sits, clear of the tray. */
const TAG_OUT = 1.3;
/** The strip down the middle of the board that the route to home runs along. */
const ROUTE_STRIP: Area = {
  x0: -FIELD_HALF_W,
  x1: FIELD_HALF_W,
  z0: -ROUTE_LANE - 0.45,
  z1: ROUTE_LANE + 0.45,
};
/** Where the HOME tag sits in home, in from the edge: beyond the end of the route. */
const HOME_TAG_DEPTH = 3.6;

export interface Coaching {
  /** Whether a lesson's card is up. */
  active: () => boolean;
  /** Says thrown dice have landed: what they allow can now be shown. */
  landed: () => void;
  /** Says the player has picked a checker to move. */
  picked: () => void;
  /**
   * Teaches whatever the incoming view calls for. `previous` is the view it replaces, if
   * any; `fresh` says a new game began with it.
   */
  update: (previous: PlayerView | null, next: PlayerView, fresh: boolean) => void;
  /**
   * Takes the lesson down at once, whether it is up or still fading out: the game is over
   * or the screen is going away, so nothing may linger into what comes next.
   */
  stop: () => void;
}

/**
 * The lessons of one game screen: when to teach, and what to light and say. `onDone` runs
 * when a card is dismissed or times out, with the view as it is then.
 */
export function createCoaching(
  { stage, board, coach }: { stage: Stage; board: BoardView; coach: Coach },
  local: boolean,
  onDone: (view: PlayerView) => void,
  /** Whether dice are in the air, so that what they will allow is not known yet. */
  rolling: () => boolean,
): Coaching {
  let view: PlayerView | null = null;
  let progress: Progress | null = null;
  /** The lesson on screen now, if any, and what its guide on the board is showing. */
  let lesson: Lesson | null = null;
  let guide: Guide | null = null;
  /** Whose home keeps a faint frame after their first lesson, until their first move. */
  let marked: Player | null = null;
  const unmark = () => {
    if (!marked) return;
    marked = null;
    board.markHome(null);
  };
  /**
   * How much to enlarge the route's marks: a narrow screen draws the board small, and
   * chevrons sized for a desktop would shrink to hairlines there.
   */
  const routeScale = () => Math.min(1.4, Math.max(1, 1100 / stage.lens.bounds().width));

  /** A spot on the playfield, on screen. */
  const screen = (at: { x: number; z: number }) => stage.toScreen(at.x, at.z);
  /** An area's corners on screen. */
  const corners = (area: Area) =>
    [
      [area.x0, area.z0],
      [area.x1, area.z0],
      [area.x1, area.z1],
      [area.x0, area.z1],
    ].map(([x = 0, z = 0]) => stage.toScreen(x, z));
  /**
   * For a bear-off lesson, where a checker stands that the dice can carry off now, so the
   * route can start at it. None while no die is left to do it.
   */
  const leaving = (next: Lesson): Leaving | null => {
    // Nothing is said about dice still in the air: the rings appear only once they land.
    if (next.kind !== "bearOff" || !view || view.current !== next.player || rolling()) {
      return null;
    }
    const moves = legalMoves(view).filter((m) => m.to === "off");
    const source = moves.find((m) => typeof m.from === "number")?.from;
    if (typeof source !== "number") return null;
    const state = view.board;
    /** How far from the middle of the board a point's innermost checker stands. */
    const inner = (index: number) => {
      const count = pointAt(state, index).count;
      const place = { kind: "point", index } as const;
      return count === 0
        ? Infinity
        : Math.min(...Array.from({ length: count }, (_, i) => Math.abs(slotPosition(place, i).z)));
    };
    // Out past the source stack, then a short hop towards the middle; never over a stack
    // the route crosses on the way to the tray, nor past the player's own tray well.
    const out = inner(source) - CLEAR;
    const nearer = Array.from({ length: POINT_COUNT }, (_, i) => i).filter((i) =>
      next.player === "white" ? i < source : i > source,
    );
    const crossings = nearer.map((i) => inner(i) - CLEAR);
    const cross = Math.max(
      OWN_WELL,
      Math.min(Math.max(Math.min(out, ROUTE_LANE), out - HOP), ...crossings),
    );
    return {
      from: { x: slotPosition({ kind: "point", index: source }, 0).x, out, cross },
      // The die a click on the tray spends for this stack, which is the smallest that can.
      dice: [Math.min(...moves.flatMap((m) => (m.from === source ? [m.die] : [])))],
      distance: next.player === "white" ? source + 1 : POINT_COUNT - source,
    };
  };
  /**
   * The ground under each of the player's own stacks outside home: lit along with the
   * route, since every one of those checkers is to travel it.
   */
  const ownStacks = (player: Player): Area[] =>
    stacks((owner, index) => owner === player && !isHome(player, index));
  /**
   * The opponent's checkers inside a player's home, one disc each, which stay dim: the
   * checkers alone, so the home's frame and points round them keep their light.
   */
  const enemyCheckers = (player: Player) => {
    if (!view) return [];
    const state = view.board;
    return state.points.flatMap((point, index) => {
      if (point.owner === player || point.count === 0 || !isHome(player, index)) return [];
      const place = { kind: "point", index } as const;
      return Array.from({ length: point.count }, (_, i) => {
        // At the height of the checker's top face, where the eye sees it, not the felt.
        const at = slotPosition(place, i);
        const top = at.y + CHECKER_H / 2;
        return Array.from({ length: 8 }, (_corner, k) => {
          const angle = (k / 8) * Math.PI * 2;
          const r = CHECKER_R * 0.95;
          return stage.toScreen(at.x + Math.cos(angle) * r, at.z + Math.sin(angle) * r, top);
        });
      });
    });
  };
  /** The ground under each stack that `pick` chooses, by its owner and point. */
  const stacks = (pick: (owner: Player, index: number) => boolean): Area[] => {
    if (!view) return [];
    const state = view.board;
    return state.points.flatMap((point, index) => {
      if (!point.owner || point.count === 0 || !pick(point.owner, index)) return [];
      const place = { kind: "point", index } as const;
      const zs = Array.from({ length: point.count }, (_, i) => slotPosition(place, i).z);
      const x = slotPosition(place, 0).x;
      const z0 = Math.min(...zs) - 0.5;
      const z1 = Math.max(...zs) + 0.5;
      return [{ x0: x - 0.5, x1: x + 0.5, z0, z1 }];
    });
  };
  /** The card's words for a lesson as things stand. */
  const textFor = (next: Lesson) => {
    const now = leaving(next);
    return lessonText(
      next,
      local,
      window.matchMedia("(pointer: coarse)").matches,
      now?.dice ?? [],
      now?.distance ?? 0,
    );
  };
  /** Lights the way on the board and puts up the card that explains it. */
  const teach = (next: Lesson) => {
    lesson = next;
    let scale = routeScale();
    guide = { ...next, from: leaving(next)?.from };
    board.setGuide(guide, prefersLessMotion(), scale);
    // The tag sits on home. For bearing off it sits beside the narrow tray it names, or
    // where the window is too narrow for that, past the tray's end at the board's edge.
    const home = homeArea(next.player);
    const tray = trayWell(next.player);
    const trayMiddle = (tray.x0 + tray.x1) / 2;
    const outer = next.player === "white" ? tray.z1 + TAG_OUT : tray.z0 - TAG_OUT;
    const trayAt = { x: trayMiddle, z: (tray.z0 + tray.z1) / 2 };
    const tagSpots =
      next.kind === "home"
        ? [{ x: (home.x0 + home.x1) / 2, z: Math.sign(home.z0 + home.z1) * HOME_TAG_DEPTH }]
        : [
            { x: tray.x1 + TAG_OUT, z: trayAt.z },
            { x: trayMiddle, z: outer },
          ];
    coach.show(
      textFor(next),
      () => ({
        spot: corners(lessonArea(next)),
        // The route to home is lit too, from the back checkers on, so it is not lost in the dark.
        lit:
          next.kind === "home"
            ? [
                ROUTE_STRIP,
                routeStart(next.player),
                trayWell(next.player),
                ...ownStacks(next.player),
              ].map(corners)
            : [],
        // The bear-off card talks about the dice: the line showing them stays in the light.
        keep: next.kind === "bearOff" ? [...document.querySelectorAll("#turn, #dice")] : [],
        // The opponent's checkers sitting in home are not part of the lesson.
        shaded: enemyCheckers(next.player),
        tag: tagSpots.map((at) => ({
          at: screen(at),
          // A bear-off tag sits off to the side of the tray, so it points at it.
          toward: next.kind === "bearOff" ? screen(trayAt) : null,
        })),
        board: corners(WHOLE_BOARD),
        room: corners(outerArea(next.player)),
        field: stage.lens.bounds(),
      }),
      {
        hold: HOLD[next.kind],
        pressDismisses: next.kind === "home",
        // A narrower window draws the board smaller: the route's marks grow to match.
        onResize: () => {
          if (lesson !== next || !guide || routeScale() === scale) return;
          scale = routeScale();
          board.setGuide(guide, prefersLessMotion(), scale);
        },
        onDone: () => {
          lesson = null;
          guide = null;
          board.setGuide(null, prefersLessMotion());
          // Home stays faintly framed until the player first moves, for a newcomer who
          // dismissed the card quickly and has not yet found their way.
          if (next.kind === "home" && view && untouched(view.board, next.player)) {
            marked = next.player;
            board.markHome(marked);
          }
          if (view) onDone(view);
        },
      },
    );
  };
  /**
   * Takes the lesson down at once, whether it is up or still fading out: the game is over
   * or this screen is going away, so nothing may linger into what comes next. Unlike a
   * dismissal it does not redraw the HUD, which belongs to the outgoing state.
   */
  const stopTeaching = () => {
    lesson = null;
    guide = null;
    coach.hide();
    board.setGuide(null, true);
    // At once, even if the frame was already fading: the board outlives this screen.
    marked = null;
    board.markHome(null, true);
  };

  /**
   * Keeps a lesson that is up in step with the board: the checker the bear-off route starts
   * from may have gone, or another may now be the one to take, and the stacks the card
   * lights or shades may have moved. The card keeps its time.
   */
  const follow = () => {
    if (lesson?.kind === "bearOff" && guide) {
      const from = leaving(lesson)?.from;
      const was = guide.from;
      if (from?.x !== was?.x || from?.out !== was?.out || from?.cross !== was?.cross) {
        guide = { ...guide, from };
        board.setGuide(guide, prefersLessMotion(), routeScale());
      }
    }
    // The card is laid out again for the board as it now stands: the stacks it lights or
    // shades may have moved, and the dice it names may be spent.
    if (lesson) coach.retext(textFor(lesson));
  };

  return {
    active: () => lesson !== null,
    landed: follow,
    picked() {
      // Picking the ringed checker is doing what the bear-off card says: it has done its job.
      if (lesson?.kind === "bearOff") coach.dismiss();
    },
    update(previous, next, fresh) {
      // In hot-seat play a lesson is for the player on turn: once the turn passes, it goes,
      // even if it was dismissed just now and is still fading.
      if (local && previous && previous.current !== next.current) stopTeaching();
      view = next;
      // A new game, or the first sight of one: nothing has been taught in it yet.
      if (fresh) progress = startProgress(next.board);
      if (progress) {
        const taught = nextLesson(progress, next, local);
        progress = taught.progress;
        if (taught.lesson) teach(taught.lesson);
      }
      // Hit after coming home: bearing off is no longer what to do next.
      const stale = lesson?.kind === "bearOff" && !allHome(next.board, lesson.player);
      if (next.phase === "over" || stale) stopTeaching();
      if (marked && !untouched(next.board, marked)) unmark();
      // The checker the bear-off route starts from may have gone, or another may now be
      // the one to take: the route follows, while the card keeps its time.
      follow();
    },
    stop: stopTeaching,
  };
}
