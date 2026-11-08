// The Hono app, without the listener: `pnpm dev` and the P11 demo serve this, and a test can drive every
// route through the same wiring — including the middleware — without binding a port (S-8.1, S-8.3).
import { Hono } from "hono";

import { noLogs } from "./middleware/no-logs.js";
import { ai } from "./routes/ai.js";
import { blobRoutes } from "./routes/blob.js";
import { quote } from "./routes/quote.js";
import { relay } from "./routes/relay.js";
import type { BlobStore } from "./store/blob.js";

export interface AppDeps {
  readonly blobs: BlobStore;
}

export const createApp = (deps: AppDeps): Hono => {
  const app = new Hono();
  // First, and on `*`, so no route can be added later that skips it.
  app.use("*", noLogs);
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/blob", blobRoutes(deps.blobs));
  app.route("/relay", relay);
  app.route("/ai", ai);
  app.route("/quote", quote);
  return app;
};
