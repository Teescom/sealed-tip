// A deploy script that gets a decimal place wrong spends 10^12 times too much, so this is the
// arithmetic every other script in here is paid in.
import assert from "node:assert/strict";
import { test } from "node:test";

import { YOCTO_PER_NEAR, formatNear, formatUnits, near, token } from "../lib/units.js";

test("near() reads a NEAR amount as 24-decimal yoctoNEAR", () => {
  assert.equal(YOCTO_PER_NEAR, 1_000_000_000_000_000_000_000_000n);
  assert.equal(near("1"), YOCTO_PER_NEAR);
  assert.equal(near("0"), 0n);
  assert.equal(near("0.05"), 50_000_000_000_000_000_000_000n);
  assert.equal(near("1.436"), 1_436_000_000_000_000_000_000_000n);
  assert.equal(near(" 6 "), 6n * YOCTO_PER_NEAR, "whitespace from .env is not a different amount");
  assert.equal(near("0.000000000000000000000001"), 1n, "the last yocto is real, not rounded away");
});

test("near() keeps the yocto it can represent and refuses what it cannot parse", () => {
  // Truncation, not rounding: a deposit is only accepted at or above the amount the chain asked for,
  // so reading up would be the direction that fails on testnet.
  assert.equal(near("1.0000000000000000000000009"), 1n * YOCTO_PER_NEAR);
  for (const bad of ["", " ", "1e24", "-1", "1.", ".5", "abc", "1,000", "0x10"]) {
    assert.throws(() => near(bad), RangeError, JSON.stringify(bad));
  }
});

test("token() scales by the token's own decimals", () => {
  assert.equal(token("500", 6), 500_000_000n);
  assert.equal(token("0.5", 6), 500_000n);
  assert.equal(token("1", 24), YOCTO_PER_NEAR);
  assert.equal(token("1.2345678", 6), 1_234_567n, "a sub-micro unit is truncated, never rounded up");
  assert.equal(token("0.0000001", 6), 0n, "less than one unit reads as zero — the contract rejects that, the reader does not invent it");
  for (const bad of ["", "-1", "1e6", "abc"]) {
    assert.throws(() => token(bad, 6), RangeError, JSON.stringify(bad));
  }
});

test("formatUnits prints the way the RPC prints an amount", () => {
  assert.equal(formatUnits(1_000_000n, 6), "1");
  assert.equal(formatUnits(1n, 6), "0.000001");
  assert.equal(formatUnits(1_500_000n, 6), "1.5", "trailing zeroes are dropped, significant ones are not");
  assert.equal(formatUnits(1_000_500n, 6), "1.0005");
  assert.equal(formatUnits(0n, 6), "0");
  assert.equal(formatUnits(-1_500_000n, 6), "-1.5");
});

test("formatNear round-trips what near() read, which is what a dry run prints", () => {
  for (const amount of ["0", "1", "0.05", "1.436", "6", "13.7", "0.000000000000000000000001"]) {
    assert.equal(formatNear(near(amount)), amount, amount);
  }
});
