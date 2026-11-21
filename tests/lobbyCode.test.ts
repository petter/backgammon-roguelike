import { describe, expect, it } from "vitest";

import { cleanCode } from "../src/ui/lobby/code.ts";

describe("cleanCode", () => {
  it("upper-cases and trims what was typed", () => {
    expect(cleanCode(" kqrtw ")).toBe("KQRTW");
  });

  it("drops separators and letters a code never contains", () => {
    expect(cleanCode("kq-r t.w")).toBe("KQRTW");
    expect(cleanCode("LIO12AB")).toBe("AB");
  });

  it("keeps at most a code's length, so a pasted link tail still fits", () => {
    expect(cleanCode("ABCDEFG")).toBe("ABCDE");
  });
});
