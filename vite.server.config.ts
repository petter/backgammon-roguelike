import { defineConfig } from "vite";

/**
 * Bundles the game server into one self-contained file, `dist-server/vercel.js`, which
 * `api/server.js` re-exports as a Vercel Function. Bundling here means the function does
 * not depend on how the platform compiles TypeScript or traces dependencies.
 */
export default defineConfig({
  publicDir: false,
  ssr: { noExternal: true },
  build: {
    ssr: "src/server/vercel.ts",
    outDir: "dist-server",
    emptyOutDir: true,
    target: "node22",
    rolldownOptions: {
      // Optional native speed-ups for `ws`; it falls back to JavaScript without them.
      external: ["bufferutil", "utf-8-validate"],
    },
  },
});
