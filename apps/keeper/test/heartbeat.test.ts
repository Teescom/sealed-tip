// S-9.1: the heartbeat. The chain-side effect is one timestamp, so what this suite can actually check is
// that the keeper keeps saying it — first beat immediately, on the interval after that, and still there
// after a failure. `keeper_last_seen` moving is the property B9 rests the "the keeper cannot be quietly
// dead" claim on, and the contract test for it is `contracts/sealedtip/tests/switch.rs`.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { KeeperCall, KeeperMethod } from "../src/near.js";
import { DEFAULT_HEARTBEAT_MS, beat, startHeartbeat } from "../src/heartbeat.js";

import { lateHandle } from "./support.js";

interface Recorder {
  /** Every call the loop attempted, successful or not — the difference between the two is the point. */
  readonly attempts: KeeperMethod[];
  readonly calls: KeeperCall;
}

const recorder = (failFirst = false): Recorder => {
  const attempts: KeeperMethod[] = [];
  const calls: KeeperCall = async (method) => {
    attempts.push(method);
    if (failFirst && attempts.length === 1) throw new Error("the network was down for that one");
    return { txHash: `tx-${attempts.length}` };
  };
  return { attempts, calls };
};

test("a beat is one `heartbeat` call with no arguments", async () => {
  const fake = recorder();
  const result = await beat(fake.calls);
  assert.deepEqual(fake.attempts, ["heartbeat"]);
  assert.deepEqual(result, { txHash: "tx-1" });
});

test("the loop beats at once and then on the interval", async () => {
  const fake = recorder();
  const slept: number[] = [];
  const box = lateHandle();
  const sleep = async (ms: number): Promise<void> => {
    slept.push(ms);
    if (slept.length >= 3) box.current?.stop();
  };

  const running = startHeartbeat({ call: fake.calls, sleep, intervalMs: 45_000 });
  box.current = running;
  await running.done;

  // Beat, wait, beat, wait, beat, wait-and-stop: three beats in three intervals, and the loop never
  // starts a fourth after `stop` is set inside the last sleep.
  assert.equal(fake.attempts.length, 3, "a beat was missed, or the loop ran past stop");
  assert.deepEqual(slept, [45_000, 45_000, 45_000]);
});

test("the default is the interval `.env.example` documents", () => {
  assert.equal(DEFAULT_HEARTBEAT_MS, 300_000);
});

test("a failed beat is reported and costs one interval, not the process", async () => {
  const fake = recorder(true);
  const errors: unknown[] = [];
  const slept: number[] = [];
  const box = lateHandle();
  const sleep = async (ms: number): Promise<void> => {
    slept.push(ms);
    if (slept.length >= 2) box.current?.stop();
  };

  const running = startHeartbeat({ call: fake.calls, sleep, onError: (error) => errors.push(error) });
  box.current = running;
  await running.done;

  assert.equal(errors.length, 1);
  assert.equal(fake.attempts.length, 2, "the loop stopped with the beat that failed");
});

test("stop ends the loop and `done` resolves, so a signal handler can shut down cleanly", async () => {
  const fake = recorder();
  let pending: (() => void) | undefined;
  const sleep = (): Promise<void> => new Promise((resolve) => (pending = resolve));

  const handle = startHeartbeat({ call: fake.calls, sleep });
  while (pending === undefined) await Promise.resolve();
  handle.stop();
  pending();
  await handle.done;

  assert.deepEqual(fake.attempts, ["heartbeat"]);
});
