/**
 * The seed for a local game: `?seed=` when it holds a number, otherwise the fallback.
 * Zero is a valid seed.
 */
export function seedFromQuery(search: string, fallback: number): number {
  const raw = new URLSearchParams(search).get("seed");
  if (raw === null || raw.trim() === "") return fallback;
  const seed = Number(raw);
  return Number.isFinite(seed) ? seed : fallback;
}
