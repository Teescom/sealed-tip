//! Views. Public tip view exposes no CIDs or keys. (S-2.11)

use near_sdk::near;

use crate::types::{Programme, ProgrammeId, ProgrammeStats, Tip, TipId, TipPublic};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    pub fn get_programme(&self, programme_id: ProgrammeId) -> Option<Programme> { let _ = programme_id; todo!("S-2.11") }
    pub fn list_programmes(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Programme> { let _ = (from_index, limit); todo!("S-2.11") }
    pub fn get_programme_stats(&self, programme_id: ProgrammeId) -> ProgrammeStats { let _ = programme_id; todo!("S-2.11") }
    pub fn get_tip_public(&self, tip_id: TipId) -> Option<TipPublic> { let _ = tip_id; todo!("S-2.11") }
    /// CIDs and sealed-key pointers (ciphertext anyway). For the panel UI.
    pub fn get_tip_for_panel(&self, tip_id: TipId) -> Option<Tip> { let _ = tip_id; todo!("S-2.11") }
}
