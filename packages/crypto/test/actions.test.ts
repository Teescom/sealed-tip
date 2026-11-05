// Parity with contracts/sealedtip/src/actions.rs: same borsh bytes, same signatures (S-6.4 / S-0.5).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOMAIN_TAG,
  SUBMIT_TAG,
  actionMessage,
  encodeSignedAction,
  sign,
  submitMessage,
  verify,
  type SignedAction,
} from "../src/index.js";
import { bytes, fixture, toSignedAction } from "./fixture.js";

const asArray = (value: Uint8Array): number[] => Array.from(value);

test("every action vector re-encodes to the fixture bytes", () => {
  assert.ok(fixture.vectors.length >= 5, "fixture must cover Checkin, Retract and every Payout shape");
  for (const vector of fixture.vectors) {
    const action = toSignedAction(vector);
    assert.deepEqual(asArray(actionMessage(action)), vector.message, vector.name);
    assert.deepEqual(asArray(actionMessage(action).subarray(0, DOMAIN_TAG.length)), asArray(DOMAIN_TAG), vector.name);
    assert.deepEqual(asArray(encodeSignedAction(action)), vector.message.slice(DOMAIN_TAG.length), vector.name);
  }
});

test("signing the fixture message with the fixture key produces the fixture signature", () => {
  for (const vector of fixture.vectors) {
    const signature = sign(bytes(vector.message), bytes(vector.secret_key));
    assert.deepEqual(asArray(signature), vector.signature, vector.name);
  }
});

test("each fixture signature verifies under its claim public key", () => {
  for (const vector of fixture.vectors) {
    assert.ok(verify(bytes(vector.signature), bytes(vector.message), bytes(vector.public_key)), vector.name);
  }
});

const claimVector = (): (typeof fixture.vectors)[number] => {
  const found = fixture.vectors.find((vector) => vector.name === "claim-near");
  if (found === undefined) throw new Error("fixture lost claim-near");
  return found;
};

const withAction = (vector: (typeof fixture.vectors)[number], action: SignedAction["action"]): Uint8Array =>
  actionMessage({ contract: vector.contract, tipId: vector.tip_id, nonce: vector.nonce, action });

test("changing the payout destination changes the signed bytes, so the signature stops verifying", () => {
  const vector = claimVector();
  const hijackedBytes = withAction(vector, {
    Claim: { payout: { Near: { account: "attacker-relayer.testnet" } } },
  });
  assert.notDeepEqual(asArray(hijackedBytes), vector.message);
  assert.equal(verify(bytes(vector.signature), hijackedBytes, bytes(vector.public_key)), false);
});

test("a replayed action with a new nonce fails", () => {
  for (const vector of fixture.vectors) {
    const action = toSignedAction(vector);
    const replay = actionMessage({ ...action, nonce: BigInt(action.nonce) + 1n });
    assert.notDeepEqual(asArray(replay), vector.message, vector.name);
    assert.equal(verify(bytes(vector.signature), replay, bytes(vector.public_key)), false, vector.name);
  }
});

test("a signature is not valid under another tipster's key", () => {
  const vector = fixture.vectors[0]!;
  const other = fixture.vectors.find((entry) => entry.key !== vector.key)!;
  assert.equal(verify(bytes(vector.signature), bytes(vector.message), bytes(other.public_key)), false);
});

test("one flipped byte in the message breaks verification", () => {
  const vector = fixture.vectors[0]!;
  const tampered = bytes(vector.message);
  tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) % 256;
  assert.equal(verify(bytes(vector.signature), tampered, bytes(vector.public_key)), false);
});

test("the contract account is inside the signed message", () => {
  for (const vector of fixture.vectors) {
    const action = toSignedAction(vector);
    const elsewhere = actionMessage({ ...action, contract: "other-sealedtip.testnet" });
    assert.equal(verify(bytes(vector.signature), elsewhere, bytes(vector.public_key)), false, vector.name);
  }
});

test("submit vectors: tag + u64 + 32 + 32 bytes, and the signature verifies", () => {
  assert.ok(fixture.submit.length >= 1);
  for (const vector of fixture.submit) {
    const message = submitMessage(vector.programme_id, bytes(vector.evidence_hash), bytes(vector.claim_pubkey));
    assert.equal(message.length, SUBMIT_TAG.length + 8 + 32 + 32, vector.name);
    assert.deepEqual(asArray(message), vector.message, vector.name);
    assert.deepEqual(asArray(sign(message, bytes(vector.secret_key))), vector.signature, vector.name);
    assert.ok(verify(bytes(vector.signature), message, bytes(vector.public_key)), vector.name);
  }
});

test("a submit signature does not carry over to another programme or evidence hash", () => {
  const vector = fixture.submit[0]!;
  const wrongProgramme = submitMessage(vector.programme_id + 1, bytes(vector.evidence_hash), bytes(vector.claim_pubkey));
  assert.equal(verify(bytes(vector.signature), wrongProgramme, bytes(vector.public_key)), false);
  const wrongEvidence = bytes(vector.evidence_hash);
  wrongEvidence[0] = (wrongEvidence[0]! + 1) % 256;
  const wrongHash = submitMessage(vector.programme_id, wrongEvidence, bytes(vector.claim_pubkey));
  assert.equal(verify(bytes(vector.signature), wrongHash, bytes(vector.public_key)), false);
});
