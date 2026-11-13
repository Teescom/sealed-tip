// The durable queue's rules, against an in-memory Redis fake — what matters is the delay survives a
// process boundary: an action is stored with a "not before" score, `drainDue` sends only what is due,
// and a failed send still leaves the set so it cannot sit in the set forever.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Kv } from "../src/relay/kv.js";
import { kvRelayQueue } from "../src/relay/kv-queue.js";

const fakeKv = (): Kv => {
  const keys = new Map<string, unknown>();
  const scores = new Map<string, number>();
  return {
    get: async (key) => (keys.has(key) ? (keys.get(key) as never) : null),
    set: async (key, value) => {
      keys.set(key, value);
    },
    del: async (...ks) => {
      for (const k of ks) keys.delete(k);
    },
    zadd: async (_key, score, member) => {
      scores.set(member, score);
    },
    zrangebyscore: async (_key, min, max) =>
      [...scores.entries()].filter(([, s]) => s >= min && s <= max).map(([m]) => m),
    zrem: async (_key, ...members) => {
      for (const m of members) scores.delete(m);
    },
    zcard: async () => scores.size,
  };
};

test("an action is stored with its not-before score and sent only once it is due", async () => {
  const kv = fakeKv();
  let clock = 1_000;
  const sent: unknown[] = [];
  const queue = kvRelayQueue({
    kv,
    delayMs: () => 500,
    send: async (a) => {
      sent.push(a);
      return { txHash: `tx-${sent.length}` };
    },
    now: () => clock,
  });

  const result = await queue.enqueue({ method: "claim", args: { tip_id: 1 } });
  assert.deepEqual(result, { queuedUntil: 1500 });
  assert.equal(await queue.pending(), 1);

  assert.equal(await queue.drainDue(), 0, "sent before the delay elapsed");
  assert.equal(sent.length, 0);

  clock = 1600;
  assert.equal(await queue.drainDue(), 1);
  assert.deepEqual(sent, [{ method: "claim", args: { tip_id: 1 } }]);
  assert.equal(await queue.pending(), 0, "a sent action must leave the set");
});

test("a failed send is reported and still removed, so it cannot retry forever", async () => {
  const kv = fakeKv();
  const dropped: string[] = [];
  const queue = kvRelayQueue({
    kv,
    delayMs: () => 0,
    send: async () => {
      throw new Error("relayer out of gas");
    },
    onUndelivered: (a, error) => dropped.push(`${a.method}: ${error instanceof Error ? error.message : String(error)}`),
    now: () => 100,
  });

  await queue.enqueue({ method: "retract", args: { tip_id: 1 } });
  assert.equal(await queue.drainDue(), 0);
  assert.deepEqual(dropped, ["retract: relayer out of gas"]);
  assert.equal(await queue.pending(), 0);
});

test("the cap is enforced, best-effort across cold starts", async () => {
  const queue = kvRelayQueue({ kv: fakeKv(), delayMs: () => 0, send: async () => ({ txHash: "t" }), maxPending: 2 });
  await queue.enqueue({ method: "checkin", args: { tip_id: 1 } });
  await queue.enqueue({ method: "checkin", args: { tip_id: 2 } });
  await assert.rejects(queue.enqueue({ method: "checkin", args: { tip_id: 3 } }), /relay queue is full \(2 actions waiting\)/);
});
