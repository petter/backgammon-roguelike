import { bell, brass, burst, tone, vary, voice } from "./engine.ts";

/**
 * Every sound in the game, by what happens. Each takes a delay in seconds, so a sound can be
 * lined up with an animation that lands later. All are quiet no-ops while muted or before
 * the player has pressed anything.
 */

/** Note frequencies used below, in Hz. */
const NOTE = {
  C3: 130.81,
  G3: 196,
  Ab3: 207.65,
  C4: 261.63,
  Eb4: 311.13,
  E4: 329.63,
  G4: 392,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  C6: 1046.5,
  E6: 1318.5,
  G6: 1568,
} as const;

/** A stone checker set down on another: a hard, bright click. */
function stoneClick(delay: number, loud = 1): void {
  const v = voice(delay, 0.6);
  if (!v) return;
  const pitch = vary(0.08);
  burst(v, { filter: "bandpass", freq: 3200 * pitch, q: 1.4, gain: 0.5 * loud, decay: 0.035 });
  tone(v, { freq: 1900 * pitch, to: 1700 * pitch, gain: 0.12 * loud, decay: 0.05 });
  tone(v, { freq: 420 * pitch, gain: 0.1 * loud, decay: 0.06 });
}

/** A checker set down on the felt-lined wood: a soft, low knock. */
function feltThud(delay: number, loud = 1): void {
  const v = voice(delay, 0.5);
  if (!v) return;
  const pitch = vary(0.08);
  burst(v, { filter: "lowpass", freq: 900 * pitch, q: 0.8, gain: 0.55 * loud, decay: 0.07 });
  tone(v, { freq: 190 * pitch, to: 120 * pitch, gain: 0.32 * loud, decay: 0.09 });
  burst(v, { filter: "bandpass", freq: 2200 * pitch, q: 2, gain: 0.08 * loud, decay: 0.02 });
}

export const sfx = {
  /** A checker picked up to move: a quick, airy lift. */
  select(): void {
    const v = voice(0, 0.3);
    if (!v) return;
    tone(v, { freq: 880 * vary(0.03), to: 1320, gain: 0.07, decay: 0.07 });
    burst(v, { filter: "bandpass", freq: 2600, q: 3, gain: 0.05, decay: 0.03 });
  },

  /** A checker landing after a move, `delay` seconds from now. */
  checkerLands(delay: number, stacked: boolean): void {
    if (stacked) stoneClick(delay);
    else feltThud(delay);
  },

  /** A checker borne off into the tray: a hollow wooden clunk, and a little reward. */
  bearOff(delay: number): void {
    feltThud(delay, 0.7);
    const v = voice(delay, 0.8);
    if (!v) return;
    tone(v, { freq: 330 * vary(0.03), gain: 0.18, decay: 0.16, type: "triangle" });
    tone(v, { freq: 495 * vary(0.03), gain: 0.1, decay: 0.12, type: "triangle" });
    bell(v, NOTE.G5 * vary(0.01), 0.05, 0.4, { offset: 0.04 });
  },

  /** A blot hit: the attacker cracks down, and the victim lands on the bar later. */
  hit(strikeDelay: number, barDelay: number): void {
    stoneClick(strikeDelay, 1.4);
    const v = voice(strikeDelay, 0.8);
    if (v) {
      tone(v, { freq: 140, to: 55, gain: 0.5, decay: 0.22 });
      burst(v, { filter: "highpass", freq: 1800, q: 0.7, gain: 0.22, decay: 0.08 });
      // A low, wry two-note sting: someone just lost ground.
      brass(v, { freq: NOTE.G3, gain: 0.06, hold: 0.06, release: 0.18, offset: 0.06, bright: 4 });
      brass(v, { freq: NOTE.C3 * 1.06, gain: 0.07, hold: 0.1, release: 0.3, offset: 0.16 });
    }
    stoneClick(barDelay, 0.8);
  },

  /** The board slammed: a deep thump that rings in the table. */
  boardThump(strength = 1, delay = 0): void {
    const v = voice(delay, 1);
    if (!v) return;
    const s = Math.min(strength, 2);
    tone(v, { freq: 75, to: 38, gain: 0.45 * s, decay: 0.35 + 0.2 * s });
    burst(v, { filter: "lowpass", freq: 260, gain: 0.5 * s, decay: 0.25 + 0.15 * s });
    burst(v, { filter: "bandpass", freq: 900, q: 1.2, gain: 0.12 * s, decay: 0.06 });
  },

  /** Every checker thrown up and clattering back down. */
  clatter(strength = 1, delay = 0): void {
    const count = Math.round(10 + 6 * strength);
    for (let i = 0; i < count; i++) {
      const at = delay + 0.17 + Math.random() * 0.45 * (i / count + 0.4);
      const loud = (0.25 + Math.random() * 0.45) * Math.min(strength, 1.4);
      if (Math.random() < 0.6) stoneClick(at, loud);
      else feltThud(at, loud);
    }
  },

  /** The dice leave the hand: a short rattle and a swish. */
  diceThrown(): void {
    const v = voice(0, 0.3);
    if (!v) return;
    for (let i = 0; i < 4; i++) {
      burst(v, {
        filter: "bandpass",
        freq: 2600 * vary(0.2),
        q: 3,
        gain: 0.1,
        decay: 0.015,
        offset: i * 0.035 * vary(0.3),
      });
    }
    burst(v, {
      filter: "bandpass",
      freq: 600,
      to: 2400,
      q: 0.9,
      gain: 0.08,
      attack: 0.05,
      decay: 0.12,
    });
  },

  /** A die striking the board, a rim, a checker or the other die, at `speed` units/s. */
  dieKnock(speed: number): void {
    const loud = Math.min(1, speed / 11) ** 0.8;
    const v = voice(0, 0.5);
    if (!v) return;
    const pitch = vary(0.12);
    burst(v, { filter: "bandpass", freq: 2400 * pitch, q: 1.6, gain: 0.55 * loud, decay: 0.025 });
    tone(v, { freq: 1500 * pitch, gain: 0.1 * loud, decay: 0.035 });
    tone(v, { freq: 260 * pitch, to: 180 * pitch, gain: 0.22 * loud, decay: 0.05 });
  },

  /** The thrown dice tuck into the dice shown at the top: a soft pop. */
  diceSettled(): void {
    const v = voice(0, 0.4);
    if (!v) return;
    tone(v, { freq: 600, to: 980, gain: 0.08, decay: 0.08 });
    tone(v, { freq: 1200, to: 1960, gain: 0.03, decay: 0.06, offset: 0.05 });
  },

  /** A card flicked from the offer or the hand: a quick paper swish. */
  cardFlick(): void {
    const v = voice(0, 0.4);
    if (!v) return;
    burst(v, {
      filter: "bandpass",
      freq: 1500,
      to: 5200,
      q: 1.3,
      gain: 0.3,
      attack: 0.02,
      decay: 0.09,
    });
    burst(v, { filter: "lowpass", freq: 1400, gain: 0.18, decay: 0.04, offset: 0.1 });
  },

  /** Cards dealt into the offer, one quick swish each. */
  cardsDealt(count: number, delay = 0.25): void {
    const v = voice(delay, 0.3);
    if (!v) return;
    for (let i = 0; i < count; i++) {
      burst(v, {
        filter: "bandpass",
        freq: 2200 * vary(0.1),
        to: 4800,
        q: 1.5,
        gain: 0.2,
        attack: 0.015,
        decay: 0.05,
        offset: i * 0.08,
      });
    }
  },

  /** A card slapped down face up. */
  cardPlayed(): void {
    sfx.cardFlick();
    const v = voice(0.1, 0.8);
    if (!v) return;
    bell(v, NOTE.E5, 0.05, 0.5);
    bell(v, NOTE.C6, 0.03, 0.5, { offset: 0.06 });
  },

  /** A trap laid face down: a card set down with a dull click. */
  trapSet(): void {
    const v = voice(0, 0.4);
    if (!v) return;
    burst(v, {
      filter: "bandpass",
      freq: 2200,
      to: 900,
      q: 1,
      gain: 0.15,
      attack: 0.02,
      decay: 0.08,
    });
    tone(v, { freq: 160, gain: 0.15, decay: 0.08, offset: 0.08 });
    burst(v, { filter: "bandpass", freq: 1800, q: 4, gain: 0.12, decay: 0.02, offset: 0.1 });
  },

  /** A trap springs: a metal snap that rings. */
  trapSprung(delay = 0): void {
    const v = voice(delay, 1);
    if (!v) return;
    burst(v, { filter: "highpass", freq: 3000, gain: 0.45, decay: 0.03 });
    tone(v, { freq: 150, to: 70, gain: 0.35, decay: 0.12, type: "square" });
    bell(v, 610, 0.1, 0.7, { offset: 0.01, ratios: [1, 2.43, 3.71, 5.12] });
  },

  /** A hex settles on someone: two cold voices sliding down out of tune with each other. */
  hexCast(): void {
    const v = voice(0, 1.6);
    if (!v) return;
    tone(v, { freq: 740, to: 370, gain: 0.08, attack: 0.08, decay: 0.8, type: "triangle" });
    tone(v, { freq: 1046, to: 523, gain: 0.05, attack: 0.08, decay: 0.8, detune: 30 });
    burst(v, {
      filter: "bandpass",
      freq: 3000,
      to: 600,
      q: 6,
      gain: 0.05,
      attack: 0.1,
      decay: 0.7,
    });
  },

  /** A hex bites: a dark, dissonant sting. */
  hexStruck(delay = 0): void {
    const v = voice(delay, 1.2);
    if (!v) return;
    brass(v, { freq: 110, gain: 0.1, hold: 0.25, release: 0.5, bright: 3 });
    brass(v, { freq: 155.6, gain: 0.08, hold: 0.25, release: 0.5, bright: 3 });
    tone(v, { freq: 90, to: 50, gain: 0.3, decay: 0.4 });
  },

  /** A ward turns a hex away: a bright shimmer. */
  hexWarded(): void {
    const v = voice(0, 1.4);
    if (!v) return;
    bell(v, NOTE.C6, 0.07, 1);
    bell(v, NOTE.G6, 0.05, 0.9, { offset: 0.07 });
    burst(v, { filter: "highpass", freq: 6000, gain: 0.04, attack: 0.05, decay: 0.4 });
  },

  /** Hexes lifted: a light rising sparkle. */
  hexLifted(): void {
    const v = voice(0, 1.2);
    if (!v) return;
    [NOTE.C6, NOTE.E6, NOTE.G6].forEach((freq, i) =>
      bell(v, freq, 0.045, 0.5, { offset: i * 0.06 }),
    );
  },

  /** A shield raised: a soft metallic swell. */
  shield(): void {
    const v = voice(0, 1.2);
    if (!v) return;
    tone(v, { freq: NOTE.G4, gain: 0.07, attack: 0.12, decay: 0.7, type: "triangle" });
    tone(v, { freq: NOTE.G5 * 1.003, gain: 0.04, attack: 0.15, decay: 0.7 });
    bell(v, NOTE.C6, 0.04, 0.8, { offset: 0.12, ratios: [1, 2.76, 5.4] });
  },

  /**
   * A coin flicked up `delay` seconds from now and landing `flight` seconds later: a bright
   * ping off the thumb, a shimmer fading as it spins away, then heads rings high, tails low.
   */
  coin(heads: boolean, delay = 0, flight = 0.32): void {
    const v = voice(delay, 0.8);
    if (!v) return;
    bell(v, 2600 * vary(0.03), 0.05, 0.18, { ratios: [1, 1.52] });
    const pings = Math.max(3, Math.round(flight / 0.08));
    for (let i = 1; i < pings; i++) {
      const fade = 1 - i / pings;
      bell(v, 2400 * vary(0.05), 0.022 * fade + 0.006, 0.1, {
        offset: (i / pings) * flight * 0.8,
        ratios: [1, 1.52],
      });
    }
    bell(v, heads ? 2093 : 1397, 0.07, 0.6, { offset: flight, ratios: [1, 1.47, 2.31] });
  },

  /** The turn passes on: a wooden tock. */
  turnEnded(): void {
    const v = voice(0, 0.5);
    if (!v) return;
    tone(v, { freq: 720, to: 640, gain: 0.12, decay: 0.07, type: "triangle" });
    burst(v, { filter: "bandpass", freq: 1500, q: 3, gain: 0.08, decay: 0.03 });
  },

  /** It is now your turn: two gentle bell notes rising. */
  yourTurn(delay = 0.12): void {
    const v = voice(delay, 1);
    if (!v) return;
    bell(v, NOTE.G5, 0.07, 0.7);
    bell(v, NOTE.C6, 0.07, 0.9, { offset: 0.13 });
  },

  /** Something the rules will not allow: a muted, low double knock. */
  denied(): void {
    const v = voice(0, 0.3);
    if (!v) return;
    tone(v, { freq: 210, to: 180, gain: 0.14, decay: 0.08, type: "triangle" });
    tone(v, { freq: 160, to: 140, gain: 0.14, decay: 0.1, type: "triangle", offset: 0.09 });
  },

  /** The opponent has sat down and the match begins: a drum, a bell and a rising call. */
  matchStarted(): void {
    sfx.boardThump(0.6);
    const v = voice(0.05, 1.2);
    if (!v) return;
    bell(v, NOTE.C5, 0.1, 1.4);
    bell(v, NOTE.G5, 0.08, 1.4, { offset: 0.18 });
    brass(v, { freq: NOTE.C4, gain: 0.06, hold: 0.12, release: 0.3, offset: 0.05 });
    brass(v, { freq: NOTE.G4, gain: 0.06, hold: 0.12, release: 0.3, offset: 0.2 });
    brass(v, { freq: NOTE.C5, gain: 0.07, hold: 0.35, release: 0.8, offset: 0.35 });
    brass(v, { freq: NOTE.E4, gain: 0.04, hold: 0.35, release: 0.8, offset: 0.35 });
  },

  /** The other player wants a rematch: a friendly two-note call. */
  rematchOffered(): void {
    const v = voice(0, 1);
    if (!v) return;
    bell(v, NOTE.E5, 0.06, 0.7);
    bell(v, NOTE.G5, 0.06, 0.9, { offset: 0.12 });
  },

  /**
   * The game is won or lost. A swell builds to `impact` seconds from now, when the result
   * crest strikes down, and then a fanfare (victory) or a falling lament (defeat).
   */
  result(victory: boolean, impact: number): void {
    const rise = voice(Math.max(0, impact - 0.75), 0.8);
    if (rise) {
      burst(rise, {
        filter: "bandpass",
        freq: 300,
        to: 3500,
        q: 1.2,
        gain: 0.12,
        attack: 0.7,
        decay: 0.08,
      });
    }
    sfx.boardThump(1.6, impact);
    const v = voice(impact, 1.4);
    if (!v) return;
    if (victory) {
      // The strike: a full major chord, then a bright run up, then the chord again, held.
      for (const freq of [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5]) {
        brass(v, { freq, gain: 0.07, hold: 0.18, release: 0.4 });
      }
      bell(v, NOTE.C6, 0.08, 1.4, { offset: 0.02 });
      [NOTE.G4, NOTE.C5, NOTE.E5].forEach((freq, i) => {
        brass(v, { freq, gain: 0.07, hold: 0.09, release: 0.15, offset: 0.42 + i * 0.13 });
      });
      for (const freq of [NOTE.C4, NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5]) {
        brass(v, { freq, gain: 0.06, hold: 0.9, release: 1.4, offset: 0.82, bright: 7 });
      }
      [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C6 * 2].forEach((freq, i) => {
        bell(v, freq, 0.04, 0.9, { offset: 0.85 + i * 0.08 });
      });
    } else {
      // The crack of the emblem, then a minor line sinking away.
      burst(v, { filter: "highpass", freq: 1200, gain: 0.35, decay: 0.12 });
      burst(v, { filter: "bandpass", freq: 3500, q: 2, gain: 0.15, decay: 0.05, offset: 0.08 });
      const line = [NOTE.G4, NOTE.Eb4, NOTE.C4, NOTE.G3];
      line.forEach((freq, i) => {
        const last = i === line.length - 1;
        brass(v, {
          freq,
          gain: 0.07,
          hold: last ? 0.8 : 0.22,
          release: last ? 1.4 : 0.25,
          offset: 0.3 + i * 0.32,
          bright: 3,
        });
      });
      brass(v, { freq: NOTE.Ab3 / 2, gain: 0.06, hold: 1.6, release: 1.4, offset: 0.3, bright: 2 });
    }
  },
};
