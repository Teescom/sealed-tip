// POST /ai/redact — the stateless proxy to NEAR AI Cloud (S-8.5).
//
// "Stateless" is the promise this route has to keep, and it is testable, so it is tested: nothing is
// cached, nothing is written, and the answer goes back to the one caller who asked for it with
// `cache-control: no-store` — because the response contains the tipster's own words, and a shared cache
// upstream of this process would be a log line nobody wrote.
//
// The route decides status codes and nothing else. The three upstream calls, the nonce rule, the byte cap
// and the bucket are in `../ai/redact.ts`, and the URLs are in `../ai/cloud.ts`, so that the policy can be
// driven in a test without a port and the transport without a network.
//
// There is deliberately no GET here. A tipster asking "what did you keep about me?" should get an empty
// answer because there is nothing to answer with.

import { Hono } from "hono";

import { AI_MAX_BODY_BYTES, type Redactor } from "../ai/redact.js";
import { readJson } from "../json.js";

export interface AiDeps {
  /**
   * Null when `NEAR_AI_API_KEY` is unset: the route refuses at call time instead of the whole API refusing
   * to start, because the tip flow works without the optional AI step (ARCHITECTURE §7, `env.ts`).
   */
  readonly redactor: Redactor | null;
}

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

export const aiRoutes = (deps: AiDeps): Hono => {
  const app = new Hono();

  app.post("/redact", async (c) => {
    if (deps.redactor === null) {
      return c.json({ error: "ai redaction is not configured on this proxy" }, 503);
    }

    const body = await c.req.text();
    if (utf8Bytes(body) > AI_MAX_BODY_BYTES) {
      // The size, never a prefix of the body: an error that quotes what it refused would put the tipster's
      // text into whatever collects error messages.
      return c.json({ error: `body over the cap: ${utf8Bytes(body)} bytes, limit ${AI_MAX_BODY_BYTES}` }, 413);
    }
    const json = readJson(body);
    if (json === undefined) return c.json({ error: "expected a JSON body" }, 400);

    const outcome = await deps.redactor.redact(json);
    if (!outcome.ok) {
      if (outcome.retryAfterMs !== undefined && outcome.retryAfterMs > 0) {
        c.header("Retry-After", String(Math.ceil(outcome.retryAfterMs / 1000)));
      }
      return c.json({ error: outcome.error }, outcome.status);
    }

    return c.json(outcome.result, 200, { "cache-control": "no-store" });
  });

  app.all("*", (c) => c.json({ error: "not found" }, 404));

  return app;
};
