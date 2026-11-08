// Loads fixtures/vectors.json — the same file contracts/sealedtip/tests/vectors.rs reads (S-5.8).
import { readFileSync } from "node:fs";

import type { Action, SignedAction } from "../src/actions.js";

export type Bytes = number[];

export type FixtureAction =
  | "checkin"
  | "retract"
  | { claim_near: { account: string } }
  | { claim_intents: { deposit_address: string; memo: string | null } };

export interface KeyVector {
  name: string;
  secret: Bytes;
  passphrase: string | null;
  words: string[];
  ed25519_secret: Bytes;
  ed25519_public_key: Bytes;
  x25519_secret: Bytes;
  x25519_public_key: Bytes;
}

export interface ActionVector {
  name: string;
  key: string;
  contract: string;
  tip_id: number;
  nonce: number;
  action: FixtureAction;
  message: Bytes;
  public_key: Bytes;
  secret_key: Bytes;
  signature: Bytes;
}

export interface SubmitVector {
  name: string;
  key: string;
  programme_id: number;
  evidence_hash: Bytes;
  claim_pubkey: Bytes;
  message: Bytes;
  public_key: Bytes;
  secret_key: Bytes;
  signature: Bytes;
}

export interface HkdfLabels {
  sha: string;
  ed25519: string;
  x25519: string;
}

export interface PowVector {
  name: string;
  evidence_hash: Bytes;
  /** A JSON number: the generator refuses a nonce that would not survive one. */
  nonce: number;
  /** The difficulty the vector was mined for, or, for a fixed nonce, the one it reaches. */
  bits: number;
  leading_zero_bits: number;
  /** True when `nonce` is the first nonce that reaches `bits`. */
  minimal: boolean;
  hash: Bytes;
}

interface Fixture {
  hkdf_labels: HkdfLabels;
  keys: KeyVector[];
  vectors: ActionVector[];
  submit: SubmitVector[];
  pow: PowVector[];
}

export const fixture: Fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/vectors.json", import.meta.url), "utf8"),
) as Fixture;

export const keyVector = (name: string): KeyVector => {
  const found = fixture.keys.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing key vector: ${name}`);
  return found;
};

export const bytes = (value: Bytes): Uint8Array => Uint8Array.from(value);

const toAction = (value: FixtureAction): Action => {
  if (value === "checkin") return "Checkin";
  if (value === "retract") return "Retract";
  if ("claim_near" in value) return { Claim: { payout: { Near: { account: value.claim_near.account } } } };
  const { deposit_address, memo } = value.claim_intents;
  return { Claim: { payout: { Intents: { deposit_address, memo } } } };
};

export const toSignedAction = (v: ActionVector): SignedAction => ({
  contract: v.contract,
  tipId: v.tip_id,
  nonce: v.nonce,
  action: toAction(v.action),
});
