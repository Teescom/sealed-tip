//! Dead man's switch. (S-3.6–S-3.8)

use near_sdk::json_types::Base64VecU8;
use near_sdk::near;

use crate::types::{SealedKey, TipId};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Relayer, signed by tipster → next_deadline = now + interval.
    pub fn checkin(&mut self, tip_id: TipId, nonce: u64, signature: Base64VecU8) {
        let _ = (tip_id, nonce, signature);
        todo!("S-3.6")
    }

    /// Anyone, after next_deadline + grace (E18).
    pub fn trigger(&mut self, tip_id: TipId) {
        let _ = tip_id;
        todo!("S-3.7")
    }

    /// Keeper only, after trigger, non-recused members only.
    pub fn post_released_keys(&mut self, tip_id: TipId, keys: Vec<SealedKey>) {
        let _ = (tip_id, keys);
        todo!("S-3.8")
    }

    /// Keeper only.
    pub fn heartbeat(&mut self) {
        todo!("S-3.8")
    }
}
