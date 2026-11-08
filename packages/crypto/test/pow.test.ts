// Proof-of-work parity with the contract (S-6.6): the same 40 bytes, the same bit count.
//
// Two sources of truth, on purpose. The literals below are transcribed from `shasum` and are what
// `contracts/sealedtip/src/pow.rs` asserts on inline; the fixture vectors come from `pnpm gen-vectors`,
// which runs *this* code. If a suite and the contract disagree about a hash, one of the two changed the
// preimage layout, and that is the failure a tipster's mined nonce would meet on chain.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { checkPow, leadingZeroBits, powHash, solvePow } from "../src/index.js";
import { bytes, fixture } from "./fixture.js";

const fill = (byte: number): Uint8Array => new Uint8Array(32).fill(byte);
const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/// sha256(32 × 0x11 ‖ u64le(9)), from `shasum`, not from this code.
const SHA256_LE_NONCE =
  "384989a84b29f70c1b54b620711e4cb81a312ad0899f8ed5acfe53600c5433eb";
/// The same inputs with a big-endian nonce: a different hash, and an easier one.
const SHA256_BE_NONCE =
  "016bc2fbcdd6837b01ddb3e328e57e2d778613a729c6dac6aac3198c0d8a8e9d";

test("leading zero bits count from the most significant bit down", () => {
  assert.equal(leadingZeroBits(new Uint8Array(32)), 256);
  assert.equal(leadingZeroBits(fill(0x80)), 0);
  assert.equal(leadingZeroBits(new Uint8Array([0x01, ...fill(0xff)])), 7);
  // two zero bytes (16) plus 0x0f = 0000_1111 (4 more); the bytes after the first non-zero one never
  // get looked at, so filling the rest with 0xff proves they are not being scanned.
  assert.equal(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x0f, ...fill(0xff)])), 20);
});

test("the preimage is evidence_hash ‖ u64 little-endian", () => {
  assert.equal(hex(powHash(fill(0x11), 9n)), SHA256_LE_NONCE);
  assert.equal(hex(powHash(fill(0x11), 0x0900_0000_0000_0000n)), SHA256_BE_NONCE);
  // Independent of the hashing code above: the same 40 bytes through Node's own sha256.
  const preimage = Buffer.alloc(40);
  fill(0x11).forEach((byte, i) => preimage.writeUInt8(byte, i));
  preimage.writeBigUInt64LE(9n, 32);
  assert.equal(hex(powHash(fill(0x11), 9n)), createHash("sha256").update(preimage).digest("hex"));
});

test("a vector passes at its own difficulty and fails one bit above", () => {
  assert.equal(leadingZeroBits(powHash(fill(0x11), 9n)), 2);
  assert.ok(checkPow(fill(0x11), 9n, 2));
  assert.ok(!checkPow(fill(0x11), 9n, 3));
  assert.ok(!checkPow(fill(0x11), 8n, 1), "a nonce that is not a solution is not a solution");
});

test("solvePow returns the smallest nonce that clears the difficulty", async () => {
  const evidence = fill(0x11);
  assert.equal(await solvePow(evidence, 0), 0n);
  // Not 9: that vector is *a* solution, the first one is earlier. What the search owes the caller is
  // the smallest nonce that works, so every nonce below it has to fail.
  for (const bits of [2, 8, 12]) {
    const nonce = await solvePow(evidence, bits);
    assert.ok(checkPow(evidence, nonce, bits), `mined nonce ${nonce} does not verify at ${bits} bits`);
    for (let lower = 0n; lower < nonce; lower++) {
      assert.ok(!checkPow(evidence, lower, bits), `${lower} already cleared ${bits} bits`);
    }
  }
});

test("the nonce has to be a u64 and the evidence hash 32 bytes", async () => {
  assert.throws(() => powHash(fill(0x11), 1n << 64n), /u64/);
  assert.throws(() => powHash(fill(0x11), -1n), /u64/);
  assert.throws(() => powHash(new Uint8Array(31), 0n), /32 bytes/);
  await assert.rejects(() => solvePow(fill(0x11), 257), /0\.\.=256/);
  await assert.rejects(() => solvePow(fill(0x11), 1.5), /whole number/);
});

test("every shared pow vector hashes, counts and verifies the same way here", () => {
  assert.ok(fixture.pow.length >= 3, "two mined vectors and one fixed nonce above u32");
  for (const vector of fixture.pow) {
    const evidence = bytes(vector.evidence_hash);
    const nonce = BigInt(vector.nonce);
    assert.deepEqual(
      Array.from(powHash(evidence, nonce)),
      vector.hash,
      `${vector.name}: the two languages hash different preimages`,
    );
    assert.equal(leadingZeroBits(powHash(evidence, nonce)), vector.leading_zero_bits, vector.name);
    assert.ok(checkPow(evidence, nonce, vector.bits), `${vector.name}: refuses its own difficulty`);
    assert.ok(
      !checkPow(evidence, nonce, vector.leading_zero_bits + 1),
      `${vector.name}: accepts one bit over its own difficulty`,
    );
  }
});

test("solvePow reproduces the fixture's mined nonces and the fixture is solvable", async () => {
  for (const vector of fixture.pow) {
    if (!vector.minimal) continue;
    const evidence = bytes(vector.evidence_hash);
    assert.equal(
      await solvePow(evidence, vector.bits),
      BigInt(vector.nonce),
      `${vector.name}: this solver finds a different nonce than the contract was given`,
    );
  }
  // The above-u32 vector is the one that catches a u32 nonce; if it stopped overflowing u32 it would
  // be testing nothing, and a truncated nonce has to hash somewhere else.
  const large = fixture.pow.find((vector) => vector.nonce > 4294967295);
  assert.ok(large !== undefined, "a pow vector whose nonce does not fit a u32");
  const evidence = bytes(large.evidence_hash);
  const truncated = BigInt.asUintN(32, BigInt(large.nonce));
  assert.ok(truncated < BigInt(large.nonce), large.name);
  assert.notDeepEqual(
    Array.from(powHash(evidence, truncated)),
    large.hash,
    `${large.name}: a u32-truncated nonce hashes identically, so the vector proves nothing`,
  );
});
