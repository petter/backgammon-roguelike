import { allHome, type Player, untouched } from "../core/board.ts";
import type { PlayerView } from "../core/view.ts";
import type { CoachText } from "../ui/coach.ts";

/**
 * A moment the screen stops to say what the goal is: `home` when a player first sits down
 * to play, `bearOff` when all their checkers have reached home and the next step begins.
 */
export interface Lesson {
  kind: "home" | "bearOff";
  player: Player;
}

/** What each player has already been shown in this game, so nothing is said twice. */
export interface Progress {
  introduced: Record<Player, boolean>;
  home: Record<Player, boolean>;
}

const PLAYERS: Player[] = ["white", "black"];

/**
 * A fresh game's progress. A player already home when the screen first sees the game,
 * such as after a reload, is not told again.
 */
export function startProgress(board: PlayerView["board"]): Progress {
  return {
    introduced: { white: false, black: false },
    home: { white: allHome(board, "white"), black: allHome(board, "black") },
  };
}

/**
 * The lesson this view calls for, if any, and the progress after it. The screen teaches
 * whoever it belongs to: the viewer, or in hot-seat play whoever is on turn. A player is
 * introduced once, at the first sight of their turn (or of the game, online), and only
 * while none of their checkers has moved yet.
 */
export function nextLesson(
  progress: Progress,
  view: PlayerView,
  local: boolean,
): { progress: Progress; lesson: Lesson | null } {
  if (view.phase === "over") return { progress, lesson: null };
  const next = {
    introduced: { ...progress.introduced },
    home: { ...progress.home },
  };
  const learner = local ? view.current : view.you;
  let lesson: Lesson | null = null;
  for (const player of PLAYERS) {
    if (next.home[player] || !allHome(view.board, player)) continue;
    next.home[player] = true;
    if (local || player === view.you) lesson = { kind: "bearOff", player };
  }
  if (!next.introduced[learner]) {
    next.introduced[learner] = true;
    if (!lesson && untouched(view.board, learner)) lesson = { kind: "home", player: learner };
  }
  return { progress: next, lesson };
}

const NAMES = { white: "White", black: "Black" } as const;

/**
 * What the screen says for a lesson. Hot-seat play names the player; a touch screen is
 * tapped rather than clicked. `dice` are the dice that can carry a checker off right now,
 * named in the bear-off card so the ring on the board is tied to a roll.
 */
export function lessonText(
  lesson: Lesson,
  local: boolean,
  touch = false,
  dice: number[] = [],
  distance = 0,
): CoachText {
  const name = NAMES[lesson.player];
  if (lesson.kind === "home") {
    return {
      swatch: lesson.player,
      // Play starts once it goes: nothing happens until the player acts.
      hint: touch ? "Or tap anywhere" : "Or click anywhere, or press any key",
      action: "Begin",
      kicker: local ? `${name}, your goal` : "Your goal",
      title: "Bring all your checkers home",
      body: "Every checker follows the gold path into your home, the six lit triangles. Once all 15 are home, take them off the board, into the tray beside it, to win.",
      tag: "Home",
    };
  }
  const verb = touch ? "tap" : "click";
  // The die as it looks on the table (U+2680 is the face of a 1), so the card and the dice
  // in the status line point at each other.
  const faces = [...new Set(dice)]
    .toSorted((a, b) => a - b)
    .map((die) => String.fromCodePoint(0x267f + die))
    .join(" or ");
  // Only a ring that is really there is pointed to: the last die may have been spent
  // bringing the last checker home.
  // The rule first, then what it means now. A die reaching past every checker takes the
  // farthest one left.
  const exact = dice.includes(distance);
  const rule = exact
    ? "A die bears off a checker that many triangles from the tray."
    : "A die bears off a checker that many triangles from the tray; one higher than your farthest checker bears that one off.";
  // Named by its point, as more than one checker may be ringed.
  const how = faces
    ? `${rule} Your ${faces} takes the gold-ringed checker on your ${distance}-point: ${verb} it, then the tray.`
    : `When a checker is ringed in gold, ${verb} it, then the tray.`;
  return {
    swatch: lesson.player,
    // The card does not block the board: it goes by itself, or with any press, as the first does.
    hint: touch ? "Tap anywhere to close" : "Click anywhere, or press any key, to close",
    kicker: local ? `${name}, all home` : "All checkers home",
    title: "Now bear them off",
    body: `${how} First to bear off all 15 wins.`,
    tag: "Bear off",
  };
}
