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

  it("keeps at most a code's length", () => {
    expect(cleanCode("ABCDEFG")).toBe("ABCDE");
  });

  it("takes the code out of a pasted invite link", () => {
    expect(cleanCode("https://backgammon.example/g/kqrtw")).toBe("KQRTW");
    expect(cleanCode("  http://localhost:5173/g/KQRTW/ ")).toBe("KQRTW");
    expect(cleanCode("Join me: https://x.dev/g/abcde?ref=chat")).toBe("ABCDE");
  });
});
