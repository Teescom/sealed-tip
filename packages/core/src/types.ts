// TS mirror of contracts/sealedtip/src/types.rs (ARCHITECTURE §4). Change both together.
import { z } from "zod";

export const U128 = z.string().regex(/^\d+$/, "decimal string");
export const U64 = z.string().regex(/^\d+$/, "decimal string");
/** `NearToken` in Rust: a yoctoNEAR decimal string. Same wire shape as `U128`, a different unit, and a
 * UI that formats `ops_balance` as tUSDC base units is wrong in a way no test would notice. */
export const YoctoNear = z.string().regex(/^\d+$/, "yoctoNEAR decimal string");
export const AccountId = z.string().min(2).max(64);
export const Bytes32 = z.array(z.number().int().min(0).max(255)).length(32);

/**
 * `pub type Cid = String` in the contract (`contracts/sealedtip/src/types.rs`) — an opaque blob reference
 * the tipster's own client chooses and the contract stores without validating.
 *
 * The mirror has to accept what the chain can hold. The real view captured in `fixtures/views.json`
 * carries `"evidence_cid": "0a1b2c-17"`; a schema demanding 64 hex would throw on chain data that any
 * tipster can produce, since `submit_tip` is signed by the tipster and nothing checks the string — which
 * is a hostile submission taking the panel's UI down. `HexCid` is the canonical form a Sealed Tip client
 * actually writes, and that is the schema to use when the question is "did our client produce this".
 */
export const Cid = z.string();
export const HexCid = z.string().regex(/^[0-9a-f]{64}$/, "hex sha256 of ciphertext");

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
  ops_balance: YoctoNear,
  gas_drip: YoctoNear,
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

/**
 * `get_keeper_info` in `contracts/sealedtip/src/views.rs`: the keeper as the chain appointed it.
 *
 * The tipster's browser needs `keeper_x25519_pub` before it can arm a dead man's switch, and this is the
 * only source that is still right after the owner rotates the keeper.
 */
export const KeeperInfo = z.object({
  keeper: AccountId,
  keeper_x25519_pub: Bytes32,
  keeper_last_seen: U64,
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
export type KeeperInfo = z.infer<typeof KeeperInfo>;
export type ProgrammeStats = z.infer<typeof ProgrammeStats>;
