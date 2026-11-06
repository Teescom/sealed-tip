//! Tip submission (relayer), triage (panel member), resolution (panel DAO), retract. (S-3.1–S-3.4)

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{near, AccountId};

use crate::types::{Cid, CryptoHash, Ed25519PublicKey, ProgrammeId, SealedKey, SwitchInput, TipId};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Relayer only. Checks PoW, signature, ≥2 sealed keys, none to recused members. Reserves nothing.
    #[allow(clippy::too_many_arguments)]
    pub fn submit_tip(
        &mut self,
        programme_id: ProgrammeId,
        claim_pubkey: Ed25519PublicKey,
        evidence_cid: Cid,
        evidence_hash: CryptoHash,
        sealed_keys: Vec<SealedKey>,
        recused: Vec<AccountId>,
        cleaning_report_hash: CryptoHash,
        attestation_hash: Option<CryptoHash>,
        switch: Option<SwitchInput>,
        pow_nonce: u64,
        signature: Base64VecU8,
    ) -> TipId {
        let _ = (
            programme_id,
            claim_pubkey,
            evidence_cid,
            evidence_hash,
            sealed_keys,
            recused,
            cleaning_report_hash,
            attestation_hash,
            switch,
            pow_nonce,
            signature,
        );
        todo!("S-3.1")
    }

    /// Non-recused panel member. credible → reserve max_reward (or Unfunded); else Dismissed.
    pub fn triage(&mut self, tip_id: TipId, credible: bool) {
        let _ = (tip_id, credible);
        todo!("S-3.2")
    }

    /// Panel DAO only. Accept: reward ≤ max_reward, release the unused reservation. Reject: release all.
    pub fn resolve_tip(&mut self, tip_id: TipId, accept: bool, reward: Option<U128>) {
        let _ = (tip_id, accept, reward);
        todo!("S-3.3")
    }

    /// Relayer, signed by the tipster; only before a decision.
    pub fn retract(&mut self, tip_id: TipId, nonce: u64, signature: Base64VecU8) {
        let _ = (tip_id, nonce, signature);
        todo!("S-3.4")
    }
}
