import { defineConfig } from "vite";

import { gameServer } from "./src/server/devPlugin.ts";

export default defineConfig({
  plugins: [gameServer()],
});
