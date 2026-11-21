import { expect, test, vi } from "vitest";

vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));

import { redactRoomCode } from "../src/app/analytics.ts";

test("an invite path is reported without its room code", () => {
  expect(redactRoomCode("https://example.com/g/abcde")).toBe("https://example.com/g/[code]");
  expect(redactRoomCode("https://example.com/g/abcde/?seed=7")).toBe(
    "https://example.com/g/[code]/?seed=7",
  );
});

test("other paths are reported as they are", () => {
  expect(redactRoomCode("https://example.com/?seed=7")).toBe("https://example.com/?seed=7");
});
