// S-8.4: the delay is the privacy mechanism, so the queue gets tested as a timing control and not as a
// list. Three properties: an action is sent once, after a delay drawn from the configured range; a
// relayer that throws must not take the process down with it; and the number of waiting actions is
// bounded, because a queue that grows under a flood is the flood.
import assert from "node:assert/strict";
import { test } from "node:test";

import { QueueFullError, createQueue, randomDelayMs, type QueuedAction } from "../src/relay/queue.js";

const action = (method = "checkin"): QueuedAction => ({ method, args: { tip_id: 1 } });

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("a delay range that cannot vary is refused, because a constant delay is no anonymity set", () => {
  assert.throws(() => randomDelayMs(20, 5), /relay delay range 20..5s is not usable/);
  assert.throws(() => randomDelayMs(-1, 5), /not usable/);
  assert.equal(randomDelayMs(7, 7), 7000);
});

test("both ends of the range are reachable and nothing lands outside it", () => {
  // 0..1s is a thousand-and-one possible delays, so 20 000 draws make a missed endpoint a one-in-ten-
  // million event rather than a coin flip the suite would lose. What is being proved is the arithmetic:
  // the range is closed at both ends, because a half-open delay would quietly drop the slowest option.
  const draws = Array.from({ length: 20_000 }, () => randomDelayMs(0, 1));
  assert.ok(draws.every((d) => Number.isInteger(d) && d >= 0 && d <= 1000), `a delay left the range: ${Math.min(...draws)}..${Math.max(...draws)}`);
  assert.ok(new Set(draws).size > 500, "20 000 draws produced almost one value, which is not a uniform range");
  assert.equal(Math.min(...draws), 0, "the low end of the range was never drawn");
  assert.equal(Math.max(...draws), 1000, "the high end of the range was never drawn");
});

test("an action is sent once, after its delay, with the arguments the gate validated", async () => {
  const sent: { at: number; action: QueuedAction }[] = [];
  const started = Date.now();
  const queue = createQueue({
    delayMs: () => 30,
    send: async (a) => {
      sent.push({ at: Date.now() - started, action: a });
      return { txHash: `tx-${sent.length}` };
    },
  });
  await queue.enqueue(action("claim"));
  assert.equal(await queue.pending(), 1);
  assert.equal(sent.length, 0, "the queue sent before its delay");
  await queue.idle();
  assert.equal(sent.length, 1);
  assert.ok(sent[0]!.at >= 25, `the delay was ${sent[0]!.at}ms`);
  assert.deepEqual(sent[0]!.action, { method: "claim", args: { tip_id: 1 } });
  assert.equal(await queue.pending(), 0);
});

test("queuedUntil is when the action is expected on chain, which is what the 202 answers", async () => {
  let clock = 1_000;
  const queue = createQueue({ delayMs: () => 500, send: async () => ({ txHash: "t" }), now: () => clock });
  clock = 4_000;
  assert.deepEqual(await queue.enqueue(action()), { queuedUntil: 4500 });
});

test("a relayer that throws is reported and does not become an unhandled rejection", async () => {
  // Node 22 turns an unhandled rejection into a crash, so this is not a style preference: the queue
  // dying mid-flood would take every other tipster's pending action with it.
  const seen: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  const dropped: { action: QueuedAction; error: unknown }[] = [];
  try {
    const queue = createQueue({
      delayMs: () => 0,
      send: async () => {
        throw new Error("relayer out of gas");
      },
      onUndelivered: (a, error) => dropped.push({ action: a, error }),
    });
    await queue.enqueue(action("retract"));
    await queue.idle();
    await tick(10);
    assert.equal(seen.length, 0, `an unhandled rejection reached the process: ${String(seen[0])}`);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0]!.action.method, "retract");
    assert.match(String(dropped[0]!.error), /relayer out of gas/);
    assert.equal(await queue.pending(), 0, "a failed send must still release its slot");
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("the undelivered sink never sees the arguments, because it writes to a log", async () => {
  const reported: string[] = [];
  const queue = createQueue({
    delayMs: () => 0,
    send: async () => {
      throw new Error("no");
    },
    onUndelivered: (a, error) => reported.push(`${a.method}: ${String(error)}`),
  });
  await queue.enqueue({ method: "claim", args: { tip_id: 7, signature: "a-signature-that-must-not-be-logged" } });
  await queue.idle();
  assert.deepEqual(reported, ["claim: Error: no"]);
});

test("a flood stops at the cap instead of growing memory", async () => {
  // The delay is 0 and `send` never settles, so the three accepted actions are genuinely *waiting*
  // without leaving a timer that would keep this process alive for a minute.
  const queue = createQueue({ delayMs: () => 0, send: () => new Promise<never>(() => {}), maxPending: 3 });
  for (let i = 0; i < 3; i++) await queue.enqueue(action());
  assert.equal(await queue.pending(), 3);
  await assert.rejects(queue.enqueue(action()), QueueFullError);
  await assert.rejects(queue.enqueue(action()), /relay queue is full \(3 actions waiting\)/);
});

test("idle resolves once nothing is waiting, and only then", async () => {
  const queue = createQueue({ delayMs: () => 20, send: async () => ({ txHash: "t" }) });
  await queue.idle();
  await queue.enqueue(action());
  await queue.enqueue(action());
  let settled = false;
  const waiting = queue.idle().then(() => {
    settled = true;
  });
  await tick(5);
  assert.equal(settled, false, "idle resolved while two actions were still waiting");
  await waiting;
  assert.equal(await queue.pending(), 0);
});

test("an empty queue is idle immediately, so the demo script cannot deadlock on it", async () => {
  const queue = createQueue({ delayMs: () => 0, send: async () => ({ txHash: "t" }) });
  await queue.idle();
  assert.equal(await queue.pending(), 0);
});
