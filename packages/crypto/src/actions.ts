// Borsh encoding of SignedAction + domain tag; must match contracts/sealedtip/src/actions.rs byte-for-byte (S-6.4).
// Any change here → regenerate fixtures/vectors.json (`pnpm gen-vectors`) and update the Rust side.
import type { Payout } from "@sealedtip/core";

import { BorshWriter } from "./borsh.js";
import { ed } from "./ed25519.js";

export const DOMAIN_TAG = new TextEncoder().encode("sealedtip:v1");
export const SUBMIT_TAG = new TextEncoder().encode("sealedtip:v1:submit");

export type Action = "Checkin" | "Retract" | { Claim: { payout: Payout } };

export interface SignedAction {
  contract: string;
  tipId: number | bigint;
  nonce: number | bigint;
  action: Action;
}

// Discriminants are positional: they follow the `Action` and `Payout` declaration order in types.rs.
const writeAction = (w: BorshWriter, action: Action): BorshWriter => {
  if (action === "Checkin") return w.u8(0);
  if (action === "Retract") return w.u8(1);
  const { payout } = action.Claim;
  if ("Near" in payout) return w.u8(2).u8(0).string(payout.Near.account);
  return w.u8(2).u8(1).string(payout.Intents.deposit_address).optionString(payout.Intents.memo);
};

export const encodeSignedAction = (a: SignedAction): Uint8Array =>
  writeAction(new BorshWriter().string(a.contract).u64(a.tipId).u64(a.nonce), a.action).bytes();

export const actionMessage = (a: SignedAction): Uint8Array =>
  Uint8Array.from([...DOMAIN_TAG, ...encodeSignedAction(a)]);

/** Submission signs before a tip id exists, so it binds programme + evidence hash + claim key. */
export const submitMessage = (
  programmeId: number | bigint,
  evidenceHash: Uint8Array,
  claimPubkey: Uint8Array,
): Uint8Array => {
  const writer = new BorshWriter().u64(programmeId).fixed(evidenceHash, "evidenceHash").fixed(claimPubkey, "claimPubkey");
  return Uint8Array.from([...SUBMIT_TAG, ...writer.bytes()]);
};

export const sign = (message: Uint8Array, secretKey: Uint8Array): Uint8Array => ed.sign(message, secretKey);

export const verify = (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean =>
  ed.verify(signature, message, publicKey);
