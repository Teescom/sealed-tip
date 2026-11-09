// S-9.2: the switch watch. Two things are worth proving here — that the enumeration of tips is complete
// (a watcher that misses a tip misses its release), and that a switch which fires is noticed on the next
// pass, with the pass interval as the bound the row's "within 1 min" is measured against.
import assert from "node:assert/strict";
import { test } from "node:test";

import { type Tip } from "@sealedtip/core";
import { fromHex, openSealed } from "@sealedtip/crypto";

import { release } from "../src/release.js";
import { DEFAULT_WATCH_MS, MAX_NEW_TIPS_PER_POLL, newWatchState, pollOnce, startWatch } from "../src/watch.js";

import { fakeChain, lateHandle, makeTip, newMembers, sealKeeperCopy } from "./support.js";

const K_SWITCH = fromHex("22".repeat(32));

/** The way the chain fires a switch: `trigger` sets one boolean and emits. */
const fire = (tip: Tip): void => {
  if (tip.switch === null) throw new Error("a tip with no switch cannot fire");
  tip.switch = { ...tip.switch, triggered: true };
};

test("every tip is found by probing upward until the chain says it has no more", async () => {
  const chain = fakeChain(await newMembers(2));
  for (const id of [0, 1, 2]) chain.tips.set(id, makeTip(id));
  const state = newWatchState();

  await pollOnce({ views: chain.views, onTriggered: async () => {} }, state);

  assert.deepEqual([...state.open].sort(), [0, 1, 2]);
  assert.equal(state.nextUnseenId, 3, "the probe stopped one id past the last tip");
});

test("a tip with no switch is not read again, because `trigger` can only E19 on it", async () => {
  const chain = fakeChain(await newMembers(2));
  chain.tips.set(0, makeTip(0));
  chain.tips.set(1, makeTip(1, { hasSwitch: false }));
  const state = newWatchState();

  await pollOnce({ views: chain.views, onTriggered: async () => {} }, state);

  assert.deepEqual([...state.open], [0]);
});

test("a switch that has fired is flagged, and only that one", async () => {
  const chain = fakeChain(await newMembers(2));
  chain.tips.set(0, makeTip(0));
  chain.tips.set(1, makeTip(1));
  fire(chain.tips.get(1)!);
  const state = newWatchState();

  const flagged = await pollOnce({ views: chain.views, onTriggered: async () => {} }, state);

  assert.deepEqual(flagged, [1]);
  assert.deepEqual([...state.waiting], [1]);
});

test("the discovery pass is capped, so a flood of submissions cannot make one poll unbounded", async () => {
  const chain = fakeChain(await newMembers(2));
  const total = MAX_NEW_TIPS_PER_POLL + 10;
  for (let id = 0; id < total; id += 1) chain.tips.set(id, makeTip(id));
  const state = newWatchState();
  const deps = { views: chain.views, onTriggered: async () => {} };

  await pollOnce(deps, state);
  assert.equal(state.nextUnseenId, MAX_NEW_TIPS_PER_POLL);

  await pollOnce(deps, state);
  assert.equal(state.nextUnseenId, total, "the second pass did not pick the scan up where it left off");
});

test("a pass that cannot read the chain is reported and the next pass still runs", async () => {
  const chain = fakeChain(await newMembers(2));
  chain.tips.set(0, makeTip(0));
  const errors: unknown[] = [];
  let first = true;
  const views = {
    getTipPublic: async (tipId: number) => {
      if (first) {
        first = false;
        throw new Error("rpc is down");
      }
      return await chain.views.getTipPublic(tipId);
    },
  };
  let handled = 0;
  const box = lateHandle();
  const sleep = async (): Promise<void> => {
    handled += 1;
    if (handled >= 2) box.current?.stop();
  };

  const running = startWatch({ views, sleep, onError: (error) => errors.push(error), onTriggered: async () => {} });
  box.current = running;
  await running.done;

  assert.equal(errors.length, 1, "a dead pass was not reported, or was reported more than once");
  assert.equal(handled, 2, "the loop died with the pass that failed");
});

test("the loop sleeps on the configured interval, and the interval is what bounds detection", async () => {
  const chain = fakeChain(await newMembers(2));
  chain.tips.set(0, makeTip(0));
  const slept: number[] = [];
  const box = lateHandle();
  const sleep = async (ms: number): Promise<void> => {
    slept.push(ms);
    if (slept.length >= 3) box.current?.stop();
  };

  const running = startWatch({ views: chain.views, sleep, onTriggered: async () => {} });
  box.current = running;
  await running.done;

  assert.deepEqual(slept, [DEFAULT_WATCH_MS, DEFAULT_WATCH_MS, DEFAULT_WATCH_MS]);
  // S-9.2's Done-when is "detects within 1 min". The worst case is a trigger that lands just after a pass
  // reads that tip, so one interval is the whole of the detection latency before finality is added.
  assert.ok(DEFAULT_WATCH_MS <= 60_000, `${DEFAULT_WATCH_MS}ms is longer than the minute the row promises`);
});

test("a triggered switch is released once, and the released tip is never read again", async () => {
  const members = await newMembers(3);
  const keeper = members[0]!;
  const chain = fakeChain(members);
  const cid = await sealKeeperCopy(K_SWITCH, keeper.keyPair.publicKey, chain.blobs);
  chain.tips.set(0, makeTip(0, { keeperCid: cid }));
  fire(chain.tips.get(0)!);

  const deps = {
    views: chain.views,
    blobs: chain.blobs,
    call: chain.call,
    keeperX25519: { publicKey: keeper.keyPair.publicKey, secret: keeper.keyPair.secretKey },
  };

  const released: number[] = [];
  let passes = 0;
  const box = lateHandle();
  const sleep = async (): Promise<void> => {
    passes += 1;
    if (passes >= 3) box.current?.stop();
  };

  const running = startWatch({
    views: chain.views,
    sleep,
    onTriggered: async (tipId) => {
      await release(tipId, deps);
      released.push(tipId);
    },
  });
  box.current = running;
  await running.done;

  assert.deepEqual(released, [0], "the same tip was released on more than one pass");
  assert.equal(chain.calls.length, 1);
  assert.equal(chain.tips.get(0)?.released_keys.length, 3);
  // One box per member is in the store, and each of them carries the switch key.
  for (const entry of (chain.calls[0]?.args.keys as { member: string; cid: string }[]) ?? []) {
    const member = members.find((candidate) => candidate.account === entry.member)!;
    const box = chain.blobs.store.get(entry.cid);
    assert.ok(box);
    assert.deepEqual(
      Array.from(await openSealed(box, member.keyPair.publicKey, member.keyPair.secretKey)),
      Array.from(K_SWITCH),
    );
  }
});

test("a release that fails stays waiting and is retried at the next pass", async () => {
  const chain = fakeChain(await newMembers(2));
  chain.tips.set(0, makeTip(0));
  fire(chain.tips.get(0)!);

  const attempts: number[] = [];
  let passes = 0;
  const box = lateHandle();
  const sleep = async (): Promise<void> => {
    passes += 1;
    if (passes >= 3) box.current?.stop();
  };

  const running = startWatch({
    views: chain.views,
    sleep,
    onError: () => {},
    onTriggered: async (tipId) => {
      attempts.push(tipId);
      if (attempts.length === 1) throw new Error("the blob store refused the first box");
    },
  });
  box.current = running;
  await running.done;

  assert.deepEqual(attempts, [0, 0], "a failed release was not retried, or a completed one was retried too");
});

test("restarting the keeper costs a read and no transaction for a tip already answered", async () => {
  const members = await newMembers(2);
  const keeper = members[0]!;
  const chain = fakeChain(members);
  const cid = await sealKeeperCopy(K_SWITCH, keeper.keyPair.publicKey, chain.blobs);
  chain.tips.set(0, makeTip(0, { keeperCid: cid, releasedKeys: [{ member: keeper.account, cid: "already" }] }));
  fire(chain.tips.get(0)!);

  const seen: number[] = [];
  const state = newWatchState();
  const flagged = await pollOnce({ views: chain.views, onTriggered: async () => {} }, state);
  for (const tipId of flagged) {
    const outcome = await release(tipId, {
      views: chain.views,
      blobs: chain.blobs,
      call: chain.call,
      keeperX25519: { publicKey: keeper.keyPair.publicKey, secret: keeper.keyPair.secretKey },
    });
    seen.push(tipId);
    assert.deepEqual(outcome, { tipId, posted: [], skipped: "already-released" });
  }

  assert.deepEqual(seen, [0]);
  assert.equal(chain.calls.length, 0, "a keeper that restarted re-posted a release the chain already has");
});
