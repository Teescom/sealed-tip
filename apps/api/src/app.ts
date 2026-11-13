// The Hono app, without the listener: `pnpm dev` and the P11 demo serve this, and a test can drive every
// route through the same wiring — including the middleware — without binding a port (S-8.1, S-8.3).
import { Hono } from "hono";

import { cors } from "./middleware/cors.js";
import { noLogs } from "./middleware/no-logs.js";
import { blobRoutes } from "./routes/blob.js";
import type { BlobStore } from "./store/blob.js";

export interface AppDeps {
  readonly blobs: BlobStore;
  /**
   * Built by the caller, because the relay route is the one that needs a chain reader, two relayer keys
   * and a queue: `index.ts` wires the real ones with `relayRoutes({...})`, a test wires stubs, and
   * neither gets to reach for a global the way the old module-level `relay` did.
   */
  readonly relay: Hono;
  /** Same reason as `relay`: the AI proxy is the only route that holds an upstream key, so a test builds it with a fake one. */
  readonly ai: Hono;
  /** Same reason again: the quote proxy holds the 1Click key, and a test drives it against a fake transport. */
  readonly quote: Hono;
  /**
   * Origins the browser may call from. Optional so every existing test keeps working, and defaulted to the
   * two local ones because that is where the page runs during development (`middleware/cors.ts`).
   */
  readonly origins?: readonly string[];
}

export const createApp = (deps: AppDeps): Hono => {
  const app = new Hono();
  // CORS first: a preflight must be answered before anything that could reject it, and no route may be
  // added later that skips it.
  app.use("*", cors(deps.origins));
  // Then, and on `*`, so no route can be added later that skips it.
  app.use("*", noLogs);
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/blob", blobRoutes(deps.blobs));
  app.route("/relay", deps.relay);
  app.route("/ai", deps.ai);
  app.route("/quote", deps.quote);
  return app;
};
