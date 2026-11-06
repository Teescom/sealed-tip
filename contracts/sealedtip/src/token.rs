//! NEP-141/145 promises + rollback callbacks. (S-2.10)
//!
//! The `ft_transfer` / `storage_deposit` promise builders are written here in S-2.10. They were
//! `todo!()` stubs before, which clippy reported as dead code: nothing could call them until `claim`
//! exists (S-3.5), and a `#[allow]` would have hidden a real ordering problem instead of fixing it.

use near_sdk::json_types::U128;
use near_sdk::{near, PromiseError};

use crate::types::TipId;
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// On failure: status back to Accepted, balance restored.
    #[private]
    pub fn on_claim_paid(
        &mut self,
        #[callback_result] result: Result<(), PromiseError>,
        tip_id: TipId,
        amount: U128,
    ) {
        let _ = (result, tip_id, amount);
        todo!("S-2.10")
    }
}
