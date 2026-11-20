import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests do not start the game server plugin.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
