// The cron route is the only door that can spend the relayer's gas on a schedule, so the test is about the
// door: wrong or absent secret is refused with the same 401, the right one drains the queue and says how
// many it sent, and nothing is cached.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { DurableRelayQueue } from "../src/relay/kv-queue.js";
import { cronRoutes } from "../src/routes/cron.js";

const stubQueue = (sent: number[]): DurableRelayQueue => ({
  enqueue: async () => ({ queuedUntil: 0 }),
  pending: async () => 0,
  idle: async () => {},
  drainDue: async () => {
    sent.push(1);
    return 1;
  },
});

test("the cron answer requires the shared secret, and a wrong one is refused identically to a missing one", async () => {
  const app = cronRoutes({ secret: "cron-secret", queue: stubQueue([]) });

  const missing = await app.request("/relay");
  assert.equal(missing.status, 401);

  const wrong = await app.request("/relay", { headers: { authorization: "Bearer nope" } });
  assert.equal(wrong.status, 401);
  assert.equal(((await wrong.json()) as { error: string }).error, ((await missing.json()) as { error: string }).error);
});

test("the right secret drains the queue and reports the count, never cached", async () => {
  const sent: number[] = [];
  const app = cronRoutes({ secret: "cron-secret", queue: stubQueue(sent) });

  const response = await app.request("/relay", { headers: { authorization: "Bearer cron-secret" } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: 1 });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(sent.length, 1);
});
