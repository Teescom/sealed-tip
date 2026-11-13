// S-8.4: the relay route is a gate with four holes. What gets checked here is the gate itself — the
// allow-list, the order the checks run in, and what a refusal is allowed to say — against the same
// `relayRoutes(...)` wiring `index.ts` builds, with the chain replaced by a tip reader a test controls.
//
// The signature is deliberately not part of this: `relay/gate.ts` explains why verification stays on
// chain, and `no-logs.test.ts` fails the build if that reason is ever worked around by importing the
// client crypto package here.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Tip } from "@sealedtip/core";

import { admit, isRelayMethod, RELAY_METHODS } from "../src/relay/gate.js";
import { createQueue } from "../src/relay/queue.js";
import { createRateLimiter, type RateLimiter } from "../src/relay/ratelimit.js";
import { relayRoutes } from "../src/routes/relay.js";

const CONTRACT = "sealedtip.st-hack-f8d075.testnet";
const PUBKEY = Array.from({ length: 32 }, (_, i) => i + 1);
const HEX = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const SIG = Buffer.alloc(64, 7).toString("base64");
const HASH = Array.from({ length: 32 }, () => 255);

const submitBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  programme_id: 0,
  claim_pubkey: PUBKEY,
  evidence_cid: "a".repeat(64),
  evidence_hash: HASH,
  sealed_keys: [
    { member: "ara.testnet", cid: "b".repeat(64) },
    { member: "bora.testnet", cid: "c".repeat(64) },
  ],
  recused: [],
  cleaning_report_hash: HASH,
  attestation_hash: null,
  switch: null,
  pow_nonce: 41_000_000_000,
  signature: SIG,
  ...overrides,
});

const actionBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  tip_id: 7,
  nonce: 2,
  signature: SIG,
  ...overrides,
});

const fakeTip = (overrides: Partial<Tip> = {}): Tip => ({
  id: 7,
  programme_id: 0,
  claim_pubkey: PUBKEY,
  nonce: 2,
  evidence_cid: "a".repeat(64),
  evidence_hash: HASH,
  sealed_keys: [],
  recused: [],
  cleaning_report_hash: HASH,
  attestation_hash: null,
  switch: null,
  status: "Submitted",
  submitted_at: "1730000000000000000000",
  triaged_by: null,
  released_keys: [],
  ...overrides,
});

interface Harness {
  readonly app: ReturnType<typeof relayRoutes>;
  readonly limiter: RateLimiter;
  readonly reads: number[];
  pending: () => Promise<number>;
}

/**
 * A queue whose relayer never answers. The delay is 0 so no timer is left holding the test process open,
 * and `send` returns a promise that never settles, so every accepted action stays in `pending()` — which
 * is what "the queue took it" means here. What the relayer would be *handed* is `admit`'s `ticket.args`,
 * tested directly below rather than through this.
 */
const harness = (
  tips: Map<number, Tip | null> | "throw",
  options: { limiter?: RateLimiter; maxPending?: number } = {},
): Harness => {
  const reads: number[] = [];
  const limiter =
    options.limiter ??
    createRateLimiter({ keyBurst: 5, keyPerSecond: 1 / 60, globalBurst: 20, globalPerSecond: 4 / 60 });
  const queue = createQueue({
    delayMs: () => 0,
    send: () => new Promise<never>(() => {}),
    maxPending: options.maxPending ?? 100,
  });
  const app = relayRoutes({
    context: {
      contract: CONTRACT,
      tipReader: async (tipId) => {
        reads.push(tipId);
        if (tips === "throw") throw new Error("rpc unreachable");
        return tips.get(tipId) ?? null;
      },
    },
    limiter,
    queue,
  });
  return { app, limiter, reads, pending: queue.pending };
};

const post = (app: Harness["app"], action: string, body: unknown): Promise<Response> =>
  Promise.resolve(app.request(`/${action}`, { method: "POST", body: JSON.stringify(body) }));

// --- the allow-list -------------------------------------------------------------------------

test("only the four tipster actions can reach a relayer key", () => {
  assert.deepEqual([...RELAY_METHODS], ["submit_tip", "checkin", "retract", "claim"]);
  assert.ok(isRelayMethod("claim"));
  // `trigger` is the fifth tipster-side method, and the one that needs nobody: any account can fire the
  // dead man's switch, so relaying it would only put this service in front of a call that is already open.
  for (const forbidden of ["trigger", "triage", "resolve_tip", "set_relayers", "post_released_keys", "withdraw_unreserved"]) {
    assert.ok(!isRelayMethod(forbidden), `${forbidden} is not a relayer method`);
  }
});

test("an unknown action is refused with the same words whether or not the contract has it", async () => {
  const h = harness(new Map());
  const viaRelay = await post(h.app, "set_relayers", {});
  const viaNonsense = await post(h.app, "no_such_method", {});
  assert.equal(viaRelay.status, 400);
  assert.equal(viaNonsense.status, 400);
  assert.equal(await viaRelay.text(), await viaNonsense.text(), "the answer must not reveal which methods exist");
  assert.equal(h.reads.length, 0);
});

test("everything that is not a POST under /relay is not a thing this service does", async () => {
  const h = harness(new Map());
  // These are the paths as seen *inside* the mounted app: `createApp` puts it at `/relay`, so `/claim`
  // here is `/relay/claim` to a browser.
  for (const [method, path] of [
    ["GET", "/claim"],
    ["GET", "/"],
    ["POST", "/"],
  ] as const) {
    const res = await h.app.request(path, { method });
    assert.equal(res.status, 404, `${method} ${path} answered ${res.status}`);
  }
});

// --- what a refusal may say ------------------------------------------------------------------

test("a body that is not the contract's shape is refused by path, and the value is not echoed", async () => {
  const h = harness(new Map([[7, fakeTip()]]));
  const res = await post(h.app, "checkin", actionBody({ nonce: "2" }));
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(text.includes("nonce"), text);
  assert.ok(!text.includes(SIG), "a signature must not come back");
});

test("a signature that is not 64 bytes of base64 is a shape refusal, not a verification failure", async () => {
  const h = harness(new Map([[7, fakeTip()]]));
  for (const bad of ["....", "not base64!", Buffer.alloc(63, 7).toString("base64"), 42]) {
    const res = await post(h.app, "checkin", actionBody({ signature: bad }));
    assert.equal(res.status, 400, `${String(bad)} answered ${res.status}`);
  }
  assert.equal(h.reads.length, 0, "a malformed body should not cost a chain read");
});

test("a claim must name a payout rail the contract knows", async () => {
  const h = harness(new Map([[7, fakeTip()]]));
  const wrong = await post(h.app, "claim", actionBody({ payout: { Wrapped: { account: "x.near" } } }));
  assert.equal(wrong.status, 400);
  assert.ok(!(await wrong.text()).includes("Wrapped"));
  const near = await post(h.app, "claim", actionBody({ payout: { Near: { account: "fresh1234.testnet" } } }));
  assert.equal(near.status, 202);
});

// --- the chain read --------------------------------------------------------------------------

test("a call naming a tip the chain does not have is refused before anything is queued", async () => {
  const h = harness(new Map());
  const res = await post(h.app, "retract", actionBody());
  assert.equal(res.status, 404);
  assert.match(await res.text(), /no tip 7/);
  assert.equal(await h.pending(), 0);
});

test("a node we cannot reach is a 502, not a 404", async () => {
  const h = harness("throw");
  const res = await post(h.app, "checkin", actionBody());
  assert.equal(res.status, 502);
  assert.match(await res.text(), /rpc unreachable/);
  assert.equal(await h.pending(), 0);
});

test("a submission is never a chain read: there is no tip id to look up yet", async () => {
  const h = harness(new Map());
  const res = await post(h.app, "submit_tip", submitBody());
  assert.equal(res.status, 202);
  assert.equal(h.reads.length, 0);
  assert.equal(await h.pending(), 1);
});

// --- the gate itself -------------------------------------------------------------------------

test("the rate-limit key is the tipster's own pubkey, hex, and never an address", async () => {
  const fromSubmit = await admit({ contract: CONTRACT, tipReader: async () => null }, "submit_tip", submitBody());
  assert.ok(fromSubmit.ok);
  assert.equal(fromSubmit.ticket.key, HEX);

  const tips = new Map([[7, fakeTip()]]);
  const fromAction = await admit({ contract: CONTRACT, tipReader: async (id) => tips.get(id) ?? null }, "checkin", actionBody());
  assert.ok(fromAction.ok);
  assert.equal(fromAction.ticket.key, HEX);
});

test("an action's limit key comes off the chain, so a caller cannot pick which bucket it drains", async () => {
  const onChain = fakeTip({ claim_pubkey: Array.from({ length: 32 }, () => 9) });
  const verdict = await admit({ contract: CONTRACT, tipReader: async () => onChain }, "checkin", actionBody());
  assert.ok(verdict.ok);
  assert.notEqual(verdict.ticket.key, HEX);
  assert.equal(verdict.ticket.key, "09".repeat(32));
});

test("the arguments the queue forwards are the validated ones, in the contract's own names", async () => {
  const verdict = await admit({ contract: CONTRACT, tipReader: async () => null }, "submit_tip", submitBody({ extra_field: 1 }));
  assert.ok(verdict.ok);
  const args = verdict.ticket.args as Record<string, unknown> & { extra_field?: number };
  assert.equal(args.extra_field, undefined, "an unknown field must not ride along to the contract");
  assert.equal(args.pow_nonce, 41_000_000_000);
});

// --- the order the checks run in -------------------------------------------------------------

test("a flood with no global capacity is refused before a chain read or a queue slot", async () => {
  const dry = createRateLimiter({ keyBurst: 5, keyPerSecond: 1 / 60, globalBurst: 0, globalPerSecond: 0 });
  const h = harness(new Map([[7, fakeTip()]]), { limiter: dry });
  const res = await post(h.app, "checkin", actionBody());
  assert.equal(res.status, 429);
  assert.match(await res.text(), /at capacity/);
  assert.equal(h.reads.length, 0);
  assert.equal(await h.pending(), 0);
});

test("a rate-limited caller is told how long to wait and keeps its action", async () => {
  const used = createRateLimiter({ keyBurst: 1, keyPerSecond: 1 / 60, globalBurst: 20, globalPerSecond: 4 / 60 });
  const h = harness(new Map([[7, fakeTip()]]), { limiter: used });
  assert.equal((await post(h.app, "checkin", actionBody())).status, 202);
  const second = await post(h.app, "checkin", actionBody());
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("Retry-After"), "60");
  assert.equal(await h.pending(), 1, "a refused action must not have been queued");
});

test("a full queue answers 503 instead of growing memory", async () => {
  const h = harness(new Map(), { maxPending: 1 });
  assert.equal((await post(h.app, "submit_tip", submitBody())).status, 202);
  const res = await post(h.app, "submit_tip", submitBody({ claim_pubkey: Array.from({ length: 32 }, () => 4) }));
  assert.equal(res.status, 503);
  assert.match(await res.text(), /queue is full/);
});

test("an action body is capped, because a signed action is a few hundred bytes", async () => {
  const h = harness(new Map());
  const res = await h.app.request("/submit_tip", {
    method: "POST",
    body: JSON.stringify(submitBody({ recused: Array.from({ length: 4000 }, (_, i) => `member${i}.testnet`) })),
  });
  assert.equal(res.status, 413);
  assert.equal(await h.pending(), 0);
});

test("a body that is not JSON is a 400, not a crash", async () => {
  const h = harness(new Map());
  const res = await h.app.request("/checkin", { method: "POST", body: "{ this is not json" });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /JSON/);
});
