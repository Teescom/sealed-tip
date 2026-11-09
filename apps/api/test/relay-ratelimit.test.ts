// S-8.4: two token buckets, and the reason there are two is the reason this file exists. A claim pubkey is
// something a caller chooses — minting a keypair is as cheap as minting a request — so the per-key bucket
// can only ever be fairness against one misbehaving page. What bounds the work this service does, and the
// gas the two relayer accounts pay, is the shared bucket. Every test below is about which of the two is
// doing the work, and about a refusal that must not cost anything.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RELAY_LIMITS, createRateLimiter } from "../src/relay/ratelimit.js";

/** A clock a test advances by hand, so refill is arithmetic rather than a sleep. */
const clock = (start = 0): { now: () => number; advance: (ms: number) => void } => {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
};

const KEY = "ab".repeat(32);
const OTHER = "cd".repeat(32);

const limiter = (over: Partial<Parameters<typeof createRateLimiter>[0]> = {}) => {
  const c = clock();
  return {
    c,
    l: createRateLimiter({ keyBurst: 3, keyPerSecond: 1 / 60, globalBurst: 10, globalPerSecond: 1, now: c.now, ...over }),
  };
};

test("a key gets its burst and nothing more until the bucket refills", () => {
  const { c, l } = limiter();
  for (let i = 0; i < 3; i++) assert.equal(l.allow(KEY).allowed, true, `action ${i} was refused`);
  const refused = l.allow(KEY);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterMs > 0 && refused.retryAfterMs <= 60_000, `retryAfter ${refused.retryAfterMs}`);
  c.advance(60_000);
  assert.equal(l.allow(KEY).allowed, true, "one second per token bought back exactly one token");
});

test("the wait is how long until the token actually exists, not a fixed number", () => {
  const { l } = limiter({ keyBurst: 1, keyPerSecond: 1 / 60, globalBurst: 100, globalPerSecond: 10 });
  l.allow(KEY);
  assert.equal(l.allow(KEY).retryAfterMs, 60_000);
  const slow = createRateLimiter({ keyBurst: 1, keyPerSecond: 0.5, globalBurst: 100, globalPerSecond: 100, now: clock().now });
  slow.allow(KEY);
  assert.equal(slow.allow(KEY).retryAfterMs, 2_000, "at two tokens a second a wait of half a second is a round-up of 2000ms");
});

test("the shared bucket is read without being spent, so a flood cannot drain it", () => {
  const { l } = limiter({ globalBurst: 2, globalPerSecond: 0 });
  for (let i = 0; i < 50; i++) assert.equal(l.hasGlobalCapacity(), true, `check ${i} consumed a token`);
  assert.equal(l.allow(KEY).allowed, true);
  assert.equal(l.allow(OTHER).allowed, true);
  assert.equal(l.allow("ef".repeat(32)).allowed, false, "the third key should have run into the shared burst");
  assert.equal(l.hasGlobalCapacity(), false, "an empty shared bucket must say so");
});

test("a refusal costs nothing from either bucket", () => {
  const { l } = limiter({ keyBurst: 1, globalBurst: 10, globalPerSecond: 0 });
  assert.equal(l.allow(KEY).allowed, true);
  for (let i = 0; i < 5; i++) assert.equal(l.allow(KEY).allowed, false);
  const fresh = [l.allow(OTHER), l.allow("ef".repeat(32)), l.allow("01".repeat(32))];
  assert.deepEqual(fresh.map((f) => f.allowed), [true, true, true], "the exhausted key took the shared bucket with it");
});

test("the shipped limits cover one honest tipster's day, and bound what an over-eager page can burn", () => {
  // One submission, three check-ins, one claim: the actions ARCHITECTURE §9 and the PRD demo script make.
  const c = clock();
  const l = createRateLimiter({ ...RELAY_LIMITS, now: c.now });
  for (const at of [0, 3_600_000, 7_200_000, 10_800_000, 86_400_000]) {
    c.advance(at - c.now());
    assert.equal(l.allow(KEY).allowed, true, `an honest action at +${at}ms was refused`);
  }
  // Four tokens are left in the bucket after that day. A page with a retry bug burns them in one instant,
  // and the wait that follows is one minute — not a lockout, which is why a refusal costs nothing.
  for (let i = 1; i < RELAY_LIMITS.keyBurst; i++) assert.equal(l.allow(KEY).allowed, true);
  assert.equal(l.allow(KEY).allowed, false);
  assert.ok(l.allow(KEY).retryAfterMs <= 60_000);
});

test("the shipped global burst is what a flood runs into, and it is the tighter of the two", () => {
  const c = clock();
  const l = createRateLimiter({ ...RELAY_LIMITS, now: c.now });
  let allowed = 0;
  for (let i = 0; i < 100; i++) {
    if (l.allow(i.toString(16).padStart(64, "0")).allowed) allowed += 1;
  }
  assert.equal(allowed, RELAY_LIMITS.globalBurst, "the shared bucket, not the per-key one, is what stopped 100 fresh keys");
  assert.ok(RELAY_LIMITS.keyBurst <= RELAY_LIMITS.globalBurst);
});

test("buckets are forgotten past the cap, so memory cannot be the thing a flood grows", () => {
  const { l } = limiter({ maxKeys: 4, globalBurst: 1000, globalPerSecond: 1000 });
  for (let i = 0; i < 20; i++) l.allow(i.toString(16).padStart(64, "0"));
  assert.equal(l.keys(), 4);
});

test("an evicted bucket is a drained one, which is the tradeoff stated in the source", () => {
  const { c, l } = limiter({ maxKeys: 2, keyBurst: 1, globalBurst: 1000, globalPerSecond: 1000 });
  l.allow(KEY);
  c.advance(1000);
  l.allow(OTHER);
  // KEY is now the least-recently-touched and drained; a third key evicts it, and its owner gets a token
  // back early. That is the honest cost of a bounded table, and it is why the shared bucket is the limit.
  l.allow("ef".repeat(32));
  assert.equal(l.keys(), 2);
  assert.equal(l.allow(KEY).allowed, true);
});
