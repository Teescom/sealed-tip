//! Data model for `sealedtip`. Source of truth: ARCHITECTURE.md §4.
//! Mirrored in `packages/core/src/types.ts` (state) and `packages/crypto/src/actions.ts` (signed actions).
//!
//! JSON conventions:
//! - Token amounts are `U128` and NEAR amounts are `NearToken` (decimal strings).
//! - Timestamps and durations are `U64` nanoseconds (decimal strings).
//! - Keys and hashes are `[u8; 32]`. Signatures are `Base64VecU8` (serde can't do `[u8; 64]`).
//!   PRIVACY: nothing here may identify a tipster (AGENTS privacy invariants).

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, NearToken};

pub type ProgrammeId = u64;
pub type TipId = u64;
pub type CryptoHash = [u8; 32];
pub type Ed25519PublicKey = [u8; 32];
pub type X25519PublicKey = [u8; 32];
/// Pointer to a ciphertext blob: hex sha256 of the ciphertext.
pub type Cid = String;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PanelMember {
    pub account: AccountId,
    pub x25519_pub: X25519PublicKey,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Programme {
    pub id: ProgrammeId,
    pub funder: AccountId,
    pub title: String,
    /// Scope doc off-chain: lawful channels + duplicate-tip rule.
    pub scope_uri: String,
    pub scope_hash: CryptoHash,
    pub panel_dao: AccountId,
    /// Set only by `panel_dao`.
    pub panel: Vec<PanelMember>,
    pub token: AccountId,
    /// The panel picks any reward ≤ this.
    pub max_reward: U128,
    pub balance: U128,
    /// Reserved only at triage(credible=true), never at submission.
    pub reserved: U128,
    /// NEAR for storage_deposit + gas drips on claim.
    pub ops_balance: NearToken,
    pub gas_drip: NearToken,
    /// Leading zero bits required in sha256(evidence_hash ‖ pow_nonce).
    pub pow_bits: u8,
    pub open: bool,
    /// 1 = real time; >1 = demo mode. Immutable.
    pub time_scale: u32,
    pub created_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TipStatus {
    Submitted,
    Dismissed,
    UnderReview,
    /// Credible but the programme was short of funds; reserved automatically on the next `fund`.
    Unfunded,
    Accepted {
        reward: U128,
    },
    Rejected,
    Retracted,
    Paid,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SealedKey {
    pub member: AccountId,
    /// CID of K sealed to that member's X25519 key.
    pub cid: Cid,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Switch {
    pub interval: U64,
    pub grace: U64,
    pub next_deadline: U64,
    /// CID of K_switch sealed to the keeper's X25519 key.
    pub bundle_key_for_keeper: Cid,
    /// Explicit opt-in to include raw originals; default false (cleaned bundle only).
    pub includes_raw: bool,
    pub triggered: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Tip {
    pub id: TipId,
    pub programme_id: ProgrammeId,
    pub claim_pubkey: Ed25519PublicKey,
    /// Last used nonce for signed actions (next must be nonce + 1).
    pub nonce: u64,
    pub evidence_cid: Cid,
    pub evidence_hash: CryptoHash,
    /// Non-recused panel members only (≥2).
    pub sealed_keys: Vec<SealedKey>,
    pub recused: Vec<AccountId>,
    pub cleaning_report_hash: CryptoHash,
    /// None if the tipster skipped the AI step.
    pub attestation_hash: Option<CryptoHash>,
    pub switch: Option<Switch>,
    pub status: TipStatus,
    /// Relayer-delayed (timing privacy).
    pub submitted_at: U64,
    pub triaged_by: Option<AccountId>,
    /// Posted by the keeper after a trigger: K_switch re-sealed per non-recused member.
    pub released_keys: Vec<SealedKey>,
}

/// Switch settings supplied at submission.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SwitchInput {
    pub interval: U64,
    pub grace: U64,
    pub bundle_key_for_keeper: Cid,
    pub includes_raw: bool,
}

/// Payout destination. Bound inside the tipster's signed `Claim` (can't be redirected).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Payout {
    /// Fresh implicit account (testnet; storage_deposit + gas drip applied).
    Near { account: AccountId },
    /// 1Click ORIGIN_CHAIN deposit address on NEAR (mainnet).
    Intents {
        deposit_address: AccountId,
        memo: Option<String>,
    },
}

/// Signed tipster action. Message bytes = b"sealedtip:v1" ‖ borsh(SignedAction).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct SignedAction {
    pub contract: AccountId,
    pub tip_id: TipId,
    pub nonce: u64,
    pub action: Action,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Checkin,
    Retract,
    Claim { payout: Payout },
}

/// `ft_on_transfer` message, e.g. `{"fund": 0}`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FtMessage {
    Fund(ProgrammeId),
}

/// Public tip view: no CIDs, no keys.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TipPublic {
    pub id: TipId,
    pub programme_id: ProgrammeId,
    pub status: TipStatus,
    pub submitted_at: U64,
    pub switch_deadline: Option<U64>,
    pub switch_triggered: bool,
}

/// The keeper, as the chain has it.
///
/// This exists because a tipster who turns on a dead man's switch has to seal `K_switch` to the keeper's
/// X25519 public key, and `set_keeper` (S-2.9) makes that key rotatable contract state. Read from the
/// chain, sealing the switch key answers to whoever the owner appointed; read from the page's own config,
/// it answers to whoever the operator of that page wrote down — and a wrong key does not fail until the
/// switch fires, which is the worst possible moment to discover it.
///
/// Nothing here is private: `keeper_last_seen` was already public inside `ProgrammeStats`, an account id
/// is an account id, and an X25519 public key is the half that is meant to be given away.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct KeeperInfo {
    pub keeper: AccountId,
    pub keeper_x25519_pub: X25519PublicKey,
    pub keeper_last_seen: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ProgrammeStats {
    pub programme_id: ProgrammeId,
    pub balance: U128,
    pub reserved: U128,
    pub submitted: u64,
    pub under_review: u64,
    pub accepted: u64,
    pub rejected: u64,
    pub paid: u64,
    pub keeper_last_seen: U64,
}
