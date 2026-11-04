// Borsh encoding of SignedAction + domain tag; must match contracts/sealedtip/src/actions.rs byte-for-byte (S-6.4).
// Any change here → regenerate fixtures/vectors.json (`pnpm gen-vectors`) and update the Rust side.
import type { Payout } from "@sealedtip/core";

export const DOMAIN_TAG = new TextEncoder().encode("sealedtip:v1");
export const SUBMIT_TAG = new TextEncoder().encode("sealedtip:v1:submit");

export type Action = "Checkin" | "Retract" | { Claim: { payout: Payout } };

export interface SignedAction { contract: string; tipId: number; nonce: number; action: Action }

export const actionMessage = (_a: SignedAction): Uint8Array => { throw new Error("not implemented: S-6.4"); };
export const submitMessage = (_programmeId: number, _evidenceHash: Uint8Array, _claimPubkey: Uint8Array): Uint8Array => {
  throw new Error("not implemented: S-6.4");
};
export const sign = (_message: Uint8Array, _secretKey: Uint8Array): Uint8Array => { throw new Error("not implemented: S-6.4"); };
