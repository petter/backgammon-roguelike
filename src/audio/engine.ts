/**
 * The sound engine: one shared Web Audio context, a master bus with a little room on it,
 * and the few building blocks every sound is made of. Nothing is loaded from files; each
 * sound is synthesised as it is played.
 *
 * Browsers only let a page make sound once the player has pressed something, so the
 * context is made on the first press. Sounds asked for before then are simply skipped.
 */

const MUTE_KEY = "sound-muted";
const VOLUME = 0.55;
/** Share of every sound sent to the room. */
const ROOM_SEND = 0.22;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let dry: AudioNode | null = null;
let room: AudioNode | null = null;
let noise: AudioBuffer | null = null;
let muted = readMuted();
const listeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** White noise, made once: the raw stuff of clicks, knocks, swishes and rumbles. */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A small wooden room: a second of decaying noise, darker as it fades. */
function roomResponse(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * 1.1);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // A one-pole low-pass that closes over time, so the tail loses its highs first.
      const smooth = 0.2 + t * 0.75;
      last = last * smooth + (Math.random() * 2 - 1) * (1 - smooth);
      data[i] = last * (1 - t) ** 2.4;
    }
  }
  return buffer;
}

function build(): AudioContext | null {
  if (ctx) return ctx;
  const Context = typeof window === "undefined" ? undefined : window.AudioContext;
  if (!Context) return null;
  const context = new Context({ latencyHint: "interactive" });
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 10;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;
  limiter.connect(context.destination);
  master = context.createGain();
  master.gain.value = muted ? 0 : VOLUME;
  master.connect(limiter);
  dry = master;
  const reverb = context.createConvolver();
  reverb.buffer = roomResponse(context);
  const wet = context.createGain();
  wet.gain.value = ROOM_SEND;
  wet.connect(reverb);
  reverb.connect(master);
  room = wet;
  noise = noiseBuffer(context);
  ctx = context;
  return ctx;
}

function unlock(): void {
  const context = build();
  if (context && context.state !== "running") void context.resume();
}

/** Lets the page make sound from the first press or key on, as browsers require. */
export function unlockAudio(target: EventTarget = window): void {
  for (const type of ["pointerdown", "keydown", "touchend"]) {
    target.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    // Private mode or blocked storage: muting still holds for this visit.
  }
  if (ctx && master) master.gain.setTargetAtTime(next ? 0 : VOLUME, ctx.currentTime, 0.03);
  for (const listener of listeners) listener(next);
}

/** Calls `listener` whenever sound is muted or unmuted. Returns a function to stop. */
export function onMuteChange(listener: (muted: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What a sound needs to play: the context, when to start, and where to send its output. */
export interface Voice {
  ctx: AudioContext;
  /** Start time on the context's clock. */
  at: number;
  /** The output: straight to the speakers, with a share sent to the room. */
  out: AudioNode;
}

/**
 * A voice starting `delay` seconds from now, or `null` when nothing should sound: muted,
 * not yet allowed to play, or no Web Audio at all. `roomy` scales the room send.
 */
export function voice(delay = 0, roomy = 1): Voice | null {
  if (muted || ctx?.state !== "running" || !dry || !room) return null;
  const out = ctx.createGain();
  out.connect(dry);
  if (roomy > 0) {
    const send = ctx.createGain();
    send.gain.value = roomy;
    out.connect(send).connect(room);
  }
  return { ctx, at: ctx.currentTime + Math.max(0, delay) + 0.005, out };
}

/** A gain that rises to `peak` in `attack` seconds and dies away over `decay`. */
export function envelope(v: Voice, start: number, peak: number, attack: number, decay: number) {
  const gain = v.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + Math.max(attack, 0.001));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  gain.connect(v.out);
  return gain;
}

export interface ToneOptions {
  freq: number;
  /** Where the pitch slides to over the tone's life. */
  to?: number;
  type?: OscillatorType;
  gain: number;
  attack?: number;
  decay: number;
  /** Seconds after the voice's start. */
  offset?: number;
  detune?: number;
}

/** One oscillator with a pluck-shaped envelope. */
export function tone(v: Voice, o: ToneOptions): void {
  const start = v.at + (o.offset ?? 0);
  const attack = o.attack ?? 0.003;
  const end = start + attack + o.decay;
  const osc = v.ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, start);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, end);
  if (o.detune) osc.detune.value = o.detune;
  osc.connect(envelope(v, start, o.gain, attack, o.decay));
  osc.start(start);
  osc.stop(end + 0.05);
}

export interface NoiseOptions {
  filter: BiquadFilterType;
  freq: number;
  /** Where the filter sweeps to over the burst's life. */
  to?: number;
  q?: number;
  gain: number;
  attack?: number;
  decay: number;
  offset?: number;
}

/** A burst of filtered noise: a click, a knock, a swish or a rumble, by its filter. */
export function burst(v: Voice, o: NoiseOptions): void {
  if (!noise) return;
  const start = v.at + (o.offset ?? 0);
  const attack = o.attack ?? 0.001;
  const end = start + attack + o.decay;
  const source = v.ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = v.ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.frequency.setValueAtTime(o.freq, start);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, end);
  filter.Q.value = o.q ?? 1;
  source.connect(filter).connect(envelope(v, start, o.gain, attack, o.decay));
  // A random spot in the buffer, so no two bursts sound quite alike.
  source.start(start, Math.random() * 1.5);
  source.stop(end + 0.05);
}

const BELL_RATIOS = [1, 2.01, 2.76, 4.07, 5.43];

/**
 * A struck bell or metal: partials at the given ratios of `freq`, the higher ones dying
 * sooner. `offset` is seconds after the voice's start.
 */
export function bell(
  v: Voice,
  freq: number,
  gain: number,
  decay: number,
  { offset = 0, ratios = BELL_RATIOS }: { offset?: number; ratios?: readonly number[] } = {},
): void {
  ratios.forEach((ratio, i) => {
    tone(v, {
      freq: freq * ratio,
      gain: gain / (1 + i * 1.3),
      decay: decay / (1 + i * 0.7),
      offset,
      attack: 0.002,
    });
  });
}

export interface BrassOptions {
  freq: number;
  gain: number;
  offset?: number;
  /** Seconds the note is held at full strength before it fades. */
  hold: number;
  release?: number;
  /** How bright the note opens up, as a multiple of its pitch. */
  bright?: number;
}

/** A soft brass note: detuned saws through a filter that opens as the note speaks. */
export function brass(v: Voice, o: BrassOptions): void {
  const start = v.at + (o.offset ?? 0);
  const release = o.release ?? 0.5;
  const end = start + o.hold + release;
  const filter = v.ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 2;
  const bright = o.freq * (o.bright ?? 6);
  filter.frequency.setValueAtTime(o.freq * 1.2, start);
  filter.frequency.exponentialRampToValueAtTime(bright, start + 0.06);
  filter.frequency.exponentialRampToValueAtTime(o.freq * 2.5, start + o.hold + release * 0.5);
  const gain = v.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(o.gain, start + 0.04);
  gain.gain.setValueAtTime(o.gain, start + o.hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  filter.connect(gain).connect(v.out);
  for (const detune of [-8, 0, 7]) {
    const osc = v.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = o.freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(start);
    osc.stop(end + 0.05);
  }
}

/** A random factor near 1, so repeated sounds are never identical. */
export function vary(amount = 0.06): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}
