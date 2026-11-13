// The endpoint Vercel Cron hits to send the actions whose delay has elapsed (S-8.4). In a serverless
// deployment the in-process `setTimeout` never fires, so the durable queue stores each action with a "not
// before" score and this route drains what is due. Guarded by CRON_SECRET — Vercel Cron sends it in an
// Authorization header, and a stranger's GET must not be allowed to spend the relayer's gas.
import { Hono } from "hono";

import type { DurableRelayQueue } from "../relay/kv-queue.js";

export interface CronDeps {
  readonly secret: string;
  readonly queue: DurableRelayQueue;
}

export const cronRoutes = (deps: CronDeps): Hono => {
  const app = new Hono();

  app.get("/relay", async (c) => {
    const authorization = c.req.header("authorization") ?? "";
    const secret = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : authorization;
    // A constant-time comparison is not needed for a token this service generated for itself, but the
    // answer must be the same whether the secret is wrong or absent.
    if (secret !== deps.secret) {
      return c.json({ error: "not authorized" }, 401);
    }
    const sent = await deps.queue.drainDue();
    return c.json({ sent }, 200, { "cache-control": "no-store" });
  });

  return app;
};
