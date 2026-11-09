// S-8.4: two relayer accounts, and the only interesting property of having two is that a run of actions
// does not depend on one key. Everything here runs against an injected `send`, because the point is the
// rotation and the gas arithmetic, not the network — `sendTransaction` is exported separately so its key
// handling can be tested without a node, and the real call is what `pnpm demo` (P11) will exercise.
import assert from "node:assert/strict";
import { test } from "node:test";

import { KeyPair } from "near-api-js";

import { createSubmitter, sendTransaction, type Relayer, type SendTransaction } from "../src/relay/submit.js";

const A: Relayer = { account: "relayer-a.testnet", secretKey: "ed25519:2yM9secretAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const B: Relayer = { account: "relayer-b.testnet", secretKey: "ed25519:2yM9secretBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };

const CONTRACT = "sealedtip.st-hack-f8d075.testnet";

const recording = (): { send: SendTransaction; calls: { relayer: Relayer; method: string; gas: bigint }[] } => {
  const calls: { relayer: Relayer; method: string; gas: bigint }[] = [];
  return {
    calls,
    send: async (relayer, _receiver, method, _args, gas) => {
      calls.push({ relayer, method, gas });
      return { txHash: `tx-${calls.length}` };
    },
  };
};

const TGAS = 1_000_000_000_000n;

test("actions alternate between the two accounts, so neither key is a single point of failure", async () => {
  const { send, calls } = recording();
  const submitter = createSubmitter({ relayers: [A, B], contract: CONTRACT, send });
  for (const method of ["submit_tip", "checkin", "retract", "claim"]) {
    const result = await submitter.submit(method, {});
    assert.equal(result.relayer, method === "submit_tip" || method === "retract" ? A.account : B.account);
  }
  assert.deepEqual(calls.map((c) => c.relayer.account), [A.account, B.account, A.account, B.account]);
});

test("a relayer that fails does not pin every later action to it", async () => {
  // The failure is what this is for: a key whose balance ran out must cost one action, not the rest of
  // the queue. There is no health check here, so the turn advancing is the whole recovery.
  const tried: string[] = [];
  const submitter = createSubmitter({
    relayers: [A, B],
    contract: CONTRACT,
    send: async (relayer) => {
      tried.push(relayer.account);
      if (relayer.account === A.account) throw new Error("NotEnoughBalance");
      return { txHash: "tx" };
    },
  });
  await assert.rejects(() => submitter.submit("checkin", {}), /NotEnoughBalance/);
  await submitter.submit("checkin", {});
  await assert.rejects(() => submitter.submit("checkin", {}), /NotEnoughBalance/);
  assert.deepEqual(tried, [A.account, B.account, A.account]);
});

test("each method is bought the gas the contract's own sandbox suite runs green at", async () => {
  const { send, calls } = recording();
  const submitter = createSubmitter({ relayers: [A, B], contract: CONTRACT, send });
  await submitter.submit("submit_tip", {});
  await submitter.submit("claim", {});
  await submitter.submit("checkin", {});
  await submitter.submit("retract", {});
  assert.deepEqual(
    calls.map((c) => c.gas),
    [100n * TGAS, 100n * TGAS, 50n * TGAS, 50n * TGAS],
  );
});

test("a method outside the allow-list has no gas, because reaching here means the gate was bypassed", async () => {
  const { send } = recording();
  const submitter = createSubmitter({ relayers: [A, B], contract: CONTRACT, send });
  await assert.rejects(() => submitter.submit("triage", {}), /no gas configured for triage/);
});

test("next() says who would be used without using them", async () => {
  const { send, calls } = recording();
  const submitter = createSubmitter({ relayers: [A, B], contract: CONTRACT, send });
  assert.equal(submitter.next().account, A.account);
  assert.equal(submitter.next().account, A.account);
  assert.equal(calls.length, 0);
  await submitter.submit("checkin", {});
  assert.equal(submitter.next().account, B.account);
});

test("a submitter that is given neither an RPC url nor a sender refuses to guess a network", () => {
  assert.throws(
    () => createSubmitter({ relayers: [A, B], contract: CONTRACT }),
    /refusing to guess which network to spend on/,
  );
});

test("the receiver is the contract this service was configured for, never the caller's", async () => {
  const seen: string[] = [];
  const submitter = createSubmitter({
    relayers: [A, B],
    contract: CONTRACT,
    send: async (_r, receiver) => {
      seen.push(receiver);
      return { txHash: "t" };
    },
  });
  await submitter.submit("claim", {});
  assert.deepEqual(seen, [CONTRACT]);
});

// --- the real sender's key handling ------------------------------------------------------------

test("a relayer key that is not an ed25519 function-call key is refused by name, not by value", async () => {
  const secret = "ed25519:3yNnMUSTNEVERAPPEARinanylogAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const bad: Relayer = { account: "relayer-a.testnet", secretKey: `openssl:${secret.slice(9)}` };
  const send = sendTransaction("http://127.0.0.1:1");
  await assert.rejects(
    () => send(bad, CONTRACT, "checkin", {}, 50n * TGAS),
    (error: Error) => {
      assert.match(error.message, /relayer-a\.testnet is not an ed25519: key/);
      assert.ok(!error.message.includes(secret), "the startup error must not echo the key");
      return true;
    },
  );
});

test("an ed25519 key is parsed and the transaction is built; only then does the node get asked", async () => {
  // Measured, not assumed: `new KeyPairEd25519("anything")` does *not* validate its input — it fails later,
  // when signing. So a real key is the only way to prove this path reaches the network, and nothing is
  // listening on 127.0.0.1:1, which is what answers afterwards.
  const real: Relayer = { account: "relayer-a.testnet", secretKey: KeyPair.fromRandom("ed25519").toString() };
  const send = sendTransaction("http://127.0.0.1:1");
  await assert.rejects(
    () => send(real, CONTRACT, "checkin", {}, 50n * TGAS),
    (error: Error) => {
      assert.ok(!/is not an ed25519/.test(error.message), `the prefix check fired on a real key: ${error.message}`);
      assert.ok(!/Invalid|decode|base58/i.test(error.message), `the key was rejected after parsing: ${error.message}`);
      return true;
    },
  );
});
