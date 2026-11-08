// S-6.1, and the reason `fixtures/views.json` exists: these schemas are a mirror of
// `contracts/sealedtip/src/types.rs`, so the test is "the mirror accepts what the deployed wasm actually
// sent". Hand-written examples would only prove the schemas agree with themselves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";

import {
  AccountId,
  Cid,
  HexCid,
  Programme,
  ProgrammeStats,
  Switch,
  Tip,
  TipPublic,
  TipStatus,
  U128,
  YoctoNear,
} from "../src/index.js";

interface Fixture {
  readonly accounts: Record<string, string>;
  readonly get_programme: unknown;
  readonly get_programme_stats: unknown;
  readonly list_programmes: unknown;
  readonly get_tip_public: unknown;
  readonly get_tip_for_panel: unknown;
}

const views = JSON.parse(
  readFileSync(new URL("../../../fixtures/views.json", import.meta.url), "utf8"),
) as Fixture;

test("the captured views parse against the mirror schemas", () => {
  const programme = Programme.parse(views.get_programme);
  assert.equal(programme.id, 0);
  assert.equal(programme.panel.length, 3);
  assert.deepEqual(programme.panel[2], {
    account: views.accounts.member_3,
    x25519_pub: new Array(32).fill(3),
  });

  const stats = ProgrammeStats.parse(views.get_programme_stats);
  assert.equal(stats.submitted, 1);
  assert.equal(stats.keeper_last_seen, "0");

  const list = z.array(Programme).parse(views.list_programmes);
  assert.deepEqual(list[0], programme, "the same programme through either method is the same object");

  assert.deepEqual(TipPublic.parse(views.get_tip_public).status, "Submitted");
  const tip = Tip.parse(views.get_tip_for_panel);
  assert.deepEqual(tip.recused, [views.accounts.member_2]);
  assert.equal(tip.sealed_keys.length, 2);
  assert.equal(tip.switch?.triggered, true);
});

/** The unit mistake this split exists to catch: a UI that formats `ops_balance` as tUSDC base units prints
 * 1 NEAR as "0.000000000000001 tUSDC" and nothing else notices.
 *
 * The two schemas accept the same strings — `NearToken` and `U128` are both decimal strings on the wire, and
 * a programme can legitimately hold zero of either, so no pattern separates them. What carries the
 * information is the field being typed `YoctoNear` at the mirror of a Rust `NearToken`, which is why the
 * fixture's magnitudes are asserted here: they are the only place the units are written down at all. */
test("token amounts and yoctoNEAR amounts differ by unit, not by wire shape", () => {
  const programme = Programme.parse(views.get_programme);
  // tUSDC has 6 decimals: the max reward is half a token.
  assert.equal(BigInt(programme.max_reward), 500_000_000n);
  // NEAR has 24: 1 NEAR of ops balance and a 0.05 NEAR gas drip.
  assert.equal(BigInt(programme.ops_balance), 10n ** 24n);
  assert.equal(BigInt(programme.gas_drip), 5n * 10n ** 19n);

  for (const amount of [programme.max_reward, programme.ops_balance, programme.gas_drip]) {
    assert.ok(U128.safeParse(amount).success);
    assert.ok(YoctoNear.safeParse(amount).success);
  }
  assert.throws(() => U128.parse("5e24"), /decimal/);
  assert.throws(() => YoctoNear.parse(""), /yoctoNEAR/);
});

/** The capture is what falsified the original `Cid`: the contract stores `evidence_cid` as an unvalidated
 * `String`, so `Cid` has to accept it or a hostile submission breaks the panel UI. `HexCid` is the form our
 * own client writes (`packages/crypto`'s `cidOf`) and the form the blob store keys on. */
test("Cid mirrors the contract's lack of validation and HexCid is the canonical form", () => {
  const tip = Tip.parse(views.get_tip_for_panel);
  assert.equal(tip.evidence_cid, "0a1b2c-17");
  assert.ok(Cid.safeParse(tip.evidence_cid).success);
  assert.ok(!HexCid.safeParse(tip.evidence_cid).success);
  assert.ok(HexCid.safeParse("a".repeat(64)).success);
  assert.ok(!HexCid.safeParse(`${"a".repeat(63)}Z`).success);
  assert.ok(!HexCid.safeParse("A".repeat(64)).success, "the store hashes to lowercase hex");

  assert.ok(Switch.safeParse(tip.switch).success);
  assert.equal(tip.switch?.bundle_key_for_keeper, "k-switch");
});

/** `TipStatus` is an externally-tagged enum: bare strings, plus `Accepted` carrying its reward. */
test("every status the contract can write parses", () => {
  for (const status of ["Submitted", "UnderReview", "Unfunded", "Dismissed", "Rejected", "Retracted", "Paid"]) {
    assert.equal(TipStatus.parse(status), status);
  }
  assert.deepEqual(TipStatus.parse({ Accepted: { reward: "42" } }), { Accepted: { reward: "42" } });
  assert.ok(!TipStatus.safeParse({ Accepted: {} }).success);
  assert.ok(!TipStatus.safeParse("Cancelled").success, "a status the contract has never had");
});

test("nullable and required fields are as the wasm serializes them", () => {
  const tip = Tip.parse(views.get_tip_for_panel);
  // `attestation_hash` is `Option<...>` but always present in the JSON, as `null`.
  assert.ok("attestation_hash" in (views.get_tip_for_panel as object));
  assert.equal(tip.attestation_hash, null);
  assert.equal(tip.triaged_by, null);

  const noSwitch = { ...(views.get_tip_public as object), switch_deadline: null };
  assert.equal(TipPublic.parse(noSwitch).switch_deadline, null);
  // The wasm writes the deadline as a decimal string, never as a JSON number.
  assert.ok(!TipPublic.safeParse({ ...noSwitch, switch_deadline: 1 }).success);

  assert.ok(AccountId.safeParse(views.accounts.funder).success);
  assert.ok(!AccountId.safeParse("a").success, "an account id shorter than 2 characters is not one");
});
