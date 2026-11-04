//! Programmes (funder side). (S-2.6)

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, NearToken};

use crate::types::{CryptoHash, PanelMember, ProgrammeId};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Attached NEAR → ops_balance (storage_deposit + gas drips).
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn create_programme(
        &mut self,
        title: String,
        scope_uri: String,
        scope_hash: CryptoHash,
        panel_dao: AccountId,
        token: AccountId,
        max_reward: U128,
        gas_drip: NearToken,
        pow_bits: u8,
        time_scale: u32,
    ) -> ProgrammeId {
        let _ = (title, scope_uri, scope_hash, panel_dao, token, max_reward, gas_drip, pow_bits, time_scale);
        todo!("S-2.6")
    }

    /// Only up to balance − reserved (E16).
    pub fn withdraw_unreserved(&mut self, programme_id: ProgrammeId, amount: U128) {
        let _ = (programme_id, amount);
        todo!("S-2.6")
    }

    /// Blocks new tips; reservations stay until resolved.
    pub fn close_programme(&mut self, programme_id: ProgrammeId) {
        let _ = programme_id;
        todo!("S-2.6")
    }

    /// Panel DAO only.
    pub fn set_panel(&mut self, programme_id: ProgrammeId, members: Vec<PanelMember>) {
        let _ = (programme_id, members);
        todo!("S-2.8")
    }
}
