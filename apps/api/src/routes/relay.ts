// POST /relay/:action — the signed action a browser cannot pay for itself (S-8.4).
//
// A tipster has no NEAR account, so every action they sign has to be sent by someone who does. That is
// the whole job of this route, and the whole danger of it: the two keys behind it are allow-listed on
// the contract to call real methods, so the route is written as a gate with four holes.
//
//  1. Only `RELAY_METHODS` reaches further. Anything else is refused with the same answer whether or not
//     it is a real contract method, so this is not an oracle for what a deployment has installed.
//  2. The shared bucket is checked before anything expensive, so a flood cannot make the service do work
//     — and it is only *checked*, not spent, so the flood cannot exhaust the limit honest callers need.
//  3. `admit` validates the arguments against the same wasm shape `@sealedtip/core` describes and, for an
//     action, reads the tip off the chain, so a call naming a tip that does not exist is refused for free
//     instead of costing a relayer transaction. The signature itself is verified by the contract, not
//     here — see the reason in `relay/gate.ts`.
//  4. The per-pubkey bucket then the queue, which is where the delay that hides the timing link happens.
//
// The response is a 202 with the time the action is expected to be on chain, and nothing more. There is
// deliberately no receipt to poll here: the tipster's own page reads the chain through `@sealedtip/core`
// (S-6.2), so making this service the source of a tip's status would put a server in the middle of a
// privacy story that does not need one.

import { Hono } from "hono";

import { admit, isRelayMethod, type RelayContext } from "../relay/gate.js";
import { QueueFullError, type QueuedAction, type RelayQueue } from "../relay/queue.js";
import type { RateLimiter } from "../relay/ratelimit.js";

/** A signed action is a few hundred bytes; anything bigger is not a request this route was built for. */
const MAX_BODY = 16_384;

export interface RelayDeps {
  readonly context: RelayContext;
  readonly limiter: RateLimiter;
  readonly queue: RelayQueue;
}

const parse = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const relayRoutes = (deps: RelayDeps): Hono => {
  const app = new Hono();

  app.post("/:action", async (c) => {
    const action = c.req.param("action");
    if (!isRelayMethod(action)) {
      return c.json({ error: "not a relayable action" }, 400);
    }

    const body = await c.req.text();
    if (body.length > MAX_BODY) return c.json({ error: "action too large" }, 413);
    const json = parse(body);
    if (json === undefined) return c.json({ error: "expected a JSON body" }, 400);

    if (!deps.limiter.hasGlobalCapacity()) {
      return c.json({ error: "relay is at capacity" }, 429);
    }

    const verdict = await admit(deps.context, action, json);
    if (!verdict.ok) return c.json({ error: verdict.error }, verdict.status);

    const allowance = deps.limiter.allow(verdict.ticket.key);
    if (!allowance.allowed) {
      // Retry-After is the whole answer: the tipster's page can wait, and this is the one error here
      // that says what to do about it rather than what went wrong.
      c.header("Retry-After", String(Math.ceil(allowance.retryAfterMs / 1000)));
      return c.json({ error: "too many actions for this key" }, 429);
    }

    const queued: QueuedAction = { method: verdict.ticket.method, args: verdict.ticket.args };
    try {
      return c.json(deps.queue.enqueue(queued), 202);
    } catch (error) {
      if (error instanceof QueueFullError) return c.json({ error: "relay queue is full" }, 503);
      // Anything else is our bug, and the queue did not take the action. Saying so is better than a 503
      // that tells the page to back off when backing off will not help.
      throw error;
    }
  });

  // Everything else on /relay is not a thing this service does — no status endpoint, no queue listing,
  // no way to ask what somebody else's tipster submitted.
  app.all("*", (c) => c.json({ error: "not found" }, 404));

  return app;
};
