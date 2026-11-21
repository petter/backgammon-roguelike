export interface Rng {
  /** Float in [0, 1). */
  next: () => number;
  /** Integer in [0, n). */
  int: (n: number) => number;
  /** Feed this back into `createRng` to continue the same sequence. */
  readonly state: number;
}

/** Seeded mulberry32. Same seed, same sequence: the basis for run seeds and replays. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    get state() {
      return a;
    },
  };
}

export function rollDie(rng: Rng): number {
  return 1 + rng.int(6);
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    // Both indices are in range, so neither element is missing.
    const swap = out[i] as T;
    out[i] = out[j] as T;
    out[j] = swap;
  }
  return out;
}
