import { describe, expect, it } from "vitest";
import { seedFromQuery } from "../src/app/seed.ts";

describe("seedFromQuery", () => {
  it("uses the seed in the query, including zero and negatives", () => {
    expect(seedFromQuery("?seed=7", 99)).toBe(7);
    expect(seedFromQuery("?seed=0", 99)).toBe(0);
    expect(seedFromQuery("?seed=-3", 99)).toBe(-3);
    expect(seedFromQuery("?x=1&seed=12", 99)).toBe(12);
  });

  it("falls back when the seed is missing, empty or not a number", () => {
    for (const search of ["", "?seed=", "?seed=%20", "?seed=abc", "?seed=Infinity", "?other=5"]) {
      expect(seedFromQuery(search, 99), search).toBe(99);
    }
  });
});
