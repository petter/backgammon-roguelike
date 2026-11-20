// The game server as a Vercel Function. The real code lives in src/server and is bundled
// to dist-server by `pnpm build`; see vite.server.config.ts.
export { default } from "../dist-server/vercel.js";
