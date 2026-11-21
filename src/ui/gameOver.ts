import "@fontsource/cinzel/700.css";
import "@fontsource/cinzel/900.css";
import "./gameOver.css";
import { gsap } from "gsap";

import type { Player } from "../core/board.ts";
import { CHARACTERS, DEFAULT_CHARACTER } from "../core/characters.ts";
import type { PlayerView } from "../core/view.ts";
import type { LobbyView } from "../net/protocol.ts";
import { crestArt, type Outcome } from "./crestArt.ts";
import { el } from "./dom.ts";
import { createSparks } from "./sparks.ts";

/**
 * Seconds from the game ending to the crest striking down. The last checker has borne off
 * by then. The board is shaken at the same moment, so the two land as one blow.
 */
export const IMPACT_AT = 1.1;

export interface GameOverModel {
  view: PlayerView;
  lobby: LobbyView;
  /** Hot-seat: there is no loser on this screen, so it always celebrates the winner. */
  local: boolean;
  /**
   * The game was won just now, before the viewer's eyes. Otherwise (a reload, a late
   * reconnect) the result is simply shown as it stands, without the entrance.
   */
  justWon: boolean;
}

export interface GameOverScreen {
  /** Shows the result, playing the entrance the first time it appears. */
  render: (model: GameOverModel) => void;
  hide: () => void;
}

export function prefersLessMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * The full-screen result: VICTORY in gold for the winner, DEFEAT in iron for the loser,
 * with the match score and the rematch controls.
 */
export function createGameOver(actions: {
  onRematch: () => void;
  onLeave: () => void;
}): GameOverScreen {
  const root = el("gameover");
  const part = (selector: string): HTMLElement => {
    const found = root.querySelector(selector);
    if (!(found instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
    return found;
  };
  const backdrop = part(".go-backdrop");
  const bars = [...root.querySelectorAll<HTMLElement>(".go-bars i")];
  const line = part(".go-line");
  const flash = part(".go-flash");
  const hud = el("hud");
  const crest = part(".go-crest");
  const rays = part(".go-rays");
  const ring = part(".go-ring");
  const art = part(".go-art");
  const title = el("result");
  const ribbon = part(".go-ribbon");
  const headline = part(".go-headline");
  const motto = part(".go-motto");
  const score = el("score");
  const actionsBox = part(".go-actions");
  const rematch = el("rematch", HTMLButtonElement);
  const rematchStatus = el("rematch-status");
  const canvas = root.querySelector("canvas.go-sparks");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing canvas.go-sparks");
  const sparks = createSparks(canvas);
  let intro: gsap.core.Timeline | null = null;

  rematch.addEventListener("click", () => actions.onRematch());
  el("leave").addEventListener("click", () => actions.onLeave());

  const animated = () => [
    backdrop,
    canvas,
    art,
    ...bars,
    line,
    flash,
    crest,
    rays,
    ring,
    ribbon,
    score,
    actionsBox,
    title,
    ...title.children,
    ...art.querySelectorAll(".go-crack"),
  ];

  const stop = () => {
    intro?.kill();
    intro = null;
    sparks.stop();
    gsap.set(animated(), { clearProps: "all" });
    root.classList.remove("go-live");
  };

  /** The HUD fades out behind the result and takes no input while it is up. */
  const coverHud = (covered: boolean) => {
    hud.classList.toggle("covered", covered);
    // Everything but the notice, which must still be read out, such as a refused rematch.
    for (const control of hud.querySelectorAll<HTMLElement>(".row > :not(#notice)")) {
      control.inert = covered;
    }
  };

  /** Lays out everything for this result, before it is animated in. */
  const build = (model: GameOverModel, outcome: Outcome) => {
    const { view, lobby } = model;
    const winner = view.winner as Player;
    const name = (player: Player) => lobby.players[player]?.name ?? player;
    const characterOf = (player: Player) => lobby.players[player]?.character ?? DEFAULT_CHARACTER;
    // The winner's emblem in gold, or your own emblem, cracked.
    const shown = outcome === "victory" ? characterOf(winner) : characterOf(view.you);
    root.classList.toggle("victory", outcome === "victory");
    root.classList.toggle("defeat", outcome === "defeat");
    art.innerHTML = crestArt(outcome, shown);

    const word = outcome === "victory" ? "Victory" : "Defeat";
    title.setAttribute("aria-label", word);
    title.replaceChildren(
      // The words are plain ASCII, so splitting by code unit is safe.
      ...word.split("").map((letter, index) => {
        const span = document.createElement("span");
        span.textContent = letter;
        span.setAttribute("aria-hidden", "true");
        span.style.setProperty("--i", String(index));
        return span;
      }),
    );

    const yours = !model.local && winner === view.you;
    headline.textContent = yours ? "You bore off first" : `${name(winner)} bore off first`;
    const character = CHARACTERS[characterOf(winner)];
    motto.textContent = `“${character.motto}” — ${character.name}`;

    // Both tallies, the winner's one short: it ticks up once the screen has landed.
    const tally = (player: Player) => {
      const box = document.createElement("span");
      box.className = `go-tally ${player}${player === winner ? "" : " lost"}`;
      const label = document.createElement("span");
      label.className = "go-name";
      label.textContent = name(player);
      const count = document.createElement("b");
      count.textContent = String(view.wins[player]);
      if (player === winner) count.dataset.before = String(Math.max(0, view.wins[player] - 1));
      box.append(label, count);
      return box;
    };
    const dash = document.createElement("span");
    dash.className = "go-dash";
    dash.textContent = "–";
    score.replaceChildren(tally("white"), dash, tally("black"));
    score.setAttribute(
      "aria-label",
      `${name("white")} ${view.wins.white}, ${name("black")} ${view.wins.black}`,
    );
  };

  /** The entrance: bars close in, the crest strikes, the word lands, then the controls. */
  const play = (outcome: Outcome, entrance: boolean) => {
    const victory = outcome === "victory";
    const still = !entrance || prefersLessMotion();
    const narrow = window.innerWidth <= 640;
    const letters = [...title.children];
    // The crack and its highlight split together; the splinters follow.
    const [glint, crack, ...splinters] = art.querySelectorAll(".go-crack");
    const count = score.querySelector<HTMLElement>("b[data-before]");
    const after = count?.textContent ?? "";
    if (count) count.textContent = count.dataset.before ?? after;
    const impact = IMPACT_AT;
    if (!prefersLessMotion()) sparks.start(outcome);

    const tl = gsap.timeline({ onComplete: () => root.classList.add("go-live") });
    // Half dark before the strike, so the board can still be seen taking the blow.
    tl.fromTo(backdrop, { opacity: 0 }, { opacity: 0.5, duration: 0.5, ease: "power2.out" }, 0.3)
      .to(backdrop, { opacity: 1, duration: 0.5, ease: "power2.inOut" }, impact + 0.15)
      .fromTo(bars, { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease: "power3.out" }, 0.35)
      .set([ribbon, score, ...letters, ring, rays], { opacity: 0 }, 0)
      .set(actionsBox, { autoAlpha: 0 }, 0)
      .set(crest, { opacity: 0 }, 0)
      .fromTo(canvas, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.3);

    if (victory) {
      tl.fromTo(line, { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 0.3 }, 0.55)
        .to(line, { scaleY: 8, opacity: 0, duration: 0.35, ease: "power2.in" }, 0.85)
        .fromTo(
          crest,
          { scale: 3.2, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.35, ease: "power4.in" },
          impact - 0.35,
        )
        // Blur only the medallion, not the huge rays and flash layers around it.
        .fromTo(
          art,
          { filter: "blur(16px)" },
          { filter: "blur(0px)", duration: 0.35, ease: "power4.in", clearProps: "filter" },
          impact - 0.35,
        )
        .to(crest, { scale: 1.1, duration: 0.07, ease: "power1.out" }, impact)
        .to(crest, { scale: 1, duration: 0.7, ease: "elastic.out(1, 0.4)" }, impact + 0.07)
        .fromTo(rays, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 1.2 }, impact)
        .fromTo(
          letters,
          { y: -30, scale: 2.2, opacity: 0, filter: "blur(8px)" },
          {
            y: 0,
            scale: 1,
            opacity: 1,
            filter: "blur(0px)",
            duration: 0.45,
            ease: "back.out(2)",
            stagger: 0.055,
            clearProps: "filter",
          },
          impact + 0.1,
        )
        .from(
          title,
          {
            letterSpacing: narrow ? "0.25em" : "0.5em",
            duration: 1.1,
            ease: "power3.out",
            clearProps: "letterSpacing",
          },
          impact + 0.1,
        );
    } else {
      tl.fromTo(
        crest,
        { y: () => -window.innerHeight * 0.7, rotation: -12, opacity: 1, immediateRender: false },
        { y: 0, rotation: 0, duration: 0.4, ease: "power3.in" },
        impact - 0.4,
      )
        .to(crest, { scaleY: 0.86, scaleX: 1.08, duration: 0.07 }, impact)
        .to(
          crest,
          { scale: 1, rotation: 4, duration: 0.8, ease: "elastic.out(1, 0.35)" },
          impact + 0.07,
        )
        .fromTo(
          [glint, crack],
          { strokeDashoffset: 1 },
          // Unrounded: the dash runs from 1 to 0, which GSAP would snap to whole pixels.
          { strokeDashoffset: 0, duration: 0.3, ease: "power1.in", autoRound: false },
          impact + 0.15,
        )
        .fromTo(
          splinters,
          { strokeDashoffset: 1 },
          { strokeDashoffset: 0, duration: 0.2, ease: "power1.in", autoRound: false },
          impact + 0.4,
        )
        .fromTo(rays, { opacity: 0 }, { opacity: 1, duration: 1.4 }, impact)
        // Heavy letters: they drop like iron and stop dead, each with a small jolt.
        .fromTo(
          letters,
          { y: -110, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.35, ease: "power4.in", stagger: 0.05 },
          impact + 0.12,
        )
        .to(
          title,
          { keyframes: { y: [0, 5, -1, 0] }, duration: 0.3, ease: "none" },
          impact + 0.47 + 0.05 * (letters.length - 1),
        )
        // The last letter works loose and sags.
        .to(
          letters.at(-1) ?? [],
          { rotation: 9, y: 6, transformOrigin: "0% 100%", duration: 0.5, ease: "power2.in" },
          impact + 1.25,
        );
    }

    // The flash and the shockwave start bright, so they must not show before the strike.
    tl.fromTo(
      flash,
      { opacity: victory ? 0.9 : 0.75 },
      { opacity: 0, duration: 0.7, immediateRender: false },
      impact,
    )
      .fromTo(
        ring,
        { scale: 0.5, opacity: 0.9 },
        {
          scale: victory ? 3.4 : 2.4,
          opacity: 0,
          duration: 0.9,
          ease: "power2.out",
          immediateRender: false,
        },
        impact,
      )
      .call(
        () => {
          if (still) return;
          const box = crest.getBoundingClientRect();
          sparks.burst(box.left + box.width / 2, box.top + box.height / 2);
        },
        [],
        impact,
      )
      .fromTo(
        ribbon,
        { opacity: 0, clipPath: "inset(0 50% 0 50%)" },
        { opacity: 1, clipPath: "inset(0 0% 0 0%)", duration: 0.55, ease: "power3.out" },
        impact + 0.6,
      )
      .fromTo(score, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4 }, impact + 0.85)
      .call(
        () => {
          if (!count) return;
          count.textContent = after;
          if (still) return;
          count.classList.remove("go-pop");
          void count.offsetWidth;
          count.classList.add("go-pop");
        },
        [],
        impact + 1.15,
      )
      // Hidden controls take no clicks: a stray click after the last move must not leave.
      .fromTo(
        actionsBox,
        { autoAlpha: 0, y: 18 },
        { autoAlpha: 1, y: 0, duration: 0.45, immediateRender: false },
        impact + 1.3,
      )
      // Focus goes to the dialog, not to Rematch: a stray Space must not start a new game.
      .call(() => root.focus({ preventScroll: true }), [], impact + 1.3);

    intro = tl;
    if (still) tl.progress(1);
  };

  return {
    render(model) {
      const { view } = model;
      const other: Player = view.you === "white" ? "black" : "white";
      const name = (player: Player) => model.lobby.players[player]?.name ?? player;
      if (root.hidden && view.winner) {
        const outcome: Outcome = model.local || view.winner === view.you ? "victory" : "defeat";
        stop();
        build(model, outcome);
        root.hidden = false;
        coverHud(true);
        play(outcome, model.justWon);
      }
      const asked = view.rematch[view.you];
      rematch.textContent = model.local ? "Play again" : "Rematch";
      rematch.disabled = asked;
      let status = "";
      if (asked) status = `Waiting for ${name(other)}…`;
      else if (view.rematch[other]) status = `${name(other)} wants a rematch`;
      rematchStatus.textContent = status;
    },
    hide() {
      if (root.hidden) return;
      root.hidden = true;
      coverHud(false);
      stop();
    },
  };
}
