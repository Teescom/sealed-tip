// POST /quote — the 1Click quote proxy (S-8.6).
//
// The route decides status codes and nothing else: the upstream call, the asset table and the response
// mapping are in `../quote/oneclick.ts`, so the policy can be driven in a test without a network.
//
// Two properties are the point of having a proxy at all. The 1Click key never reaches a browser, and the
// tipster's payout address never reaches our logs (`noLogs` is mounted ahead of this route, and a test
// asserts it). What the proxy cannot promise is that the address stays with us: a cross-chain quote means
// 1Click learns the destination address and the amount. README lists that as a trust assumption, because a
// quote that hid it would be the one thing worse than a quote that does not exist.
//
// A quote is cached by nobody: it carries a deposit address with a deadline, and a shared cache handing one
// tipster another tipster's address would be the same defect as inventing one.

import { Hono } from "hono";

import { readJson } from "../json.js";
import { QUOTE_MAX_BODY_BYTES, type Quoter } from "../quote/oneclick.js";

export interface QuoteDeps {
  /**
   * Null when `ONECLICK_API_KEY` is unset. The 1Click endpoint answered without a key when measured, but a
   * route that spends somebody else's service is off until the owner turns it on (`env.ts`, S-0.6).
   */
  readonly quoter: Quoter | null;
}

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

export const quoteRoutes = (deps: QuoteDeps): Hono => {
  const app = new Hono();

  app.post("/", async (c) => {
    if (deps.quoter === null) {
      return c.json({ error: "the 1Click quote proxy is not configured on this service" }, 503);
    }

    const body = await c.req.text();
    if (utf8Bytes(body) > QUOTE_MAX_BODY_BYTES) {
      // The size, never a prefix: the body names the tipster's payout address.
      return c.json({ error: `body over the cap: ${utf8Bytes(body)} bytes, limit ${QUOTE_MAX_BODY_BYTES}` }, 413);
    }
    const json = readJson(body);
    if (json === undefined) return c.json({ error: "expected a JSON body" }, 400);

    const outcome = await deps.quoter.quote(json);
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);

    return c.json(outcome.quote, 200, { "cache-control": "no-store" });
  });

  app.get("/status", async (c) => {
    if (deps.quoter === null) {
      return c.json({ error: "the 1Click quote proxy is not configured on this service" }, 503);
    }
    const depositAddress = c.req.query("depositAddress");
    if (depositAddress === undefined || depositAddress.length === 0) {
      return c.json({ error: "depositAddress is required, as the quote returned it" }, 400);
    }
    const outcome = await deps.quoter.status(depositAddress);
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json({ status: outcome.state, detail: outcome.detail }, 200, { "cache-control": "no-store" });
  });

  app.all("*", (c) => c.json({ error: "not found" }, 404));

  return app;
};
