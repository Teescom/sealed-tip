// TS mirror of contracts/sealedtip/src/types.rs (ARCHITECTURE §4). Change both together.
import { z } from "zod";

export const U128 = z.string().regex(/^\d+$/);
export const U64 = z.string().regex(/^\d+$/);
export const AccountId = z.string().min(2).max(64);
export const Bytes32 = z.array(z.number().int().min(0).max(255)).length(32);
export const Cid = z.string().regex(/^[0-9a-f]{64}$/, "hex sha256 of ciphertext");

export const PanelMember = z.object({ account: AccountId, x25519_pub: Bytes32 });

export const Programme = z.object({
  id: z.number().int(),
  funder: AccountId,
  title: z.string(),
  scope_uri: z.string(),
  scope_hash: Bytes32,
  panel_dao: AccountId,
  panel: z.array(PanelMember),
  token: AccountId,
  max_reward: U128,
  balance: U128,
  reserved: U128,
  ops_balance: U128,
  gas_drip: U128,
  pow_bits: z.number().int(),
  open: z.boolean(),
  time_scale: z.number().int().positive(),
  created_at: U64,
});

export const TipStatus = z.union([
  z.enum(["Submitted", "Dismissed", "UnderReview", "Unfunded", "Rejected", "Retracted", "Paid"]),
  z.object({ Accepted: z.object({ reward: U128 }) }),
]);

export const SealedKey = z.object({ member: AccountId, cid: Cid });

export const Switch = z.object({
  interval: U64,
  grace: U64,
  next_deadline: U64,
  bundle_key_for_keeper: Cid,
  includes_raw: z.boolean(),
  triggered: z.boolean(),
});

export const Tip = z.object({
  id: z.number().int(),
  programme_id: z.number().int(),
  claim_pubkey: Bytes32,
  nonce: z.number().int(),
  evidence_cid: Cid,
  evidence_hash: Bytes32,
  sealed_keys: z.array(SealedKey),
  recused: z.array(AccountId),
  cleaning_report_hash: Bytes32,
  attestation_hash: Bytes32.nullable(),
  switch: Switch.nullable(),
  status: TipStatus,
  submitted_at: U64,
  triaged_by: AccountId.nullable(),
  released_keys: z.array(SealedKey),
});

export const Payout = z.union([
  z.object({ Near: z.object({ account: AccountId }) }),
  z.object({ Intents: z.object({ deposit_address: AccountId, memo: z.string().nullable() }) }),
]);

export const TipPublic = z.object({
  id: z.number().int(),
  programme_id: z.number().int(),
  status: TipStatus,
  submitted_at: U64,
  switch_deadline: U64.nullable(),
  switch_triggered: z.boolean(),
});

export const ProgrammeStats = z.object({
  programme_id: z.number().int(),
  balance: U128,
  reserved: U128,
  submitted: z.number().int(),
  under_review: z.number().int(),
  accepted: z.number().int(),
  rejected: z.number().int(),
  paid: z.number().int(),
  keeper_last_seen: U64,
});

export type PanelMember = z.infer<typeof PanelMember>;
export type Programme = z.infer<typeof Programme>;
export type TipStatus = z.infer<typeof TipStatus>;
export type SealedKey = z.infer<typeof SealedKey>;
export type Switch = z.infer<typeof Switch>;
export type Tip = z.infer<typeof Tip>;
export type Payout = z.infer<typeof Payout>;
export type TipPublic = z.infer<typeof TipPublic>;
export type ProgrammeStats = z.infer<typeof ProgrammeStats>;
