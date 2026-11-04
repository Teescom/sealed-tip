//! NEP-141/145 promises + rollback callbacks. (S-2.10)

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, Promise, PromiseError};

use crate::types::TipId;
use crate::{Contract, ContractExt};

impl Contract {
    pub(crate) fn ft_transfer(&self, token: AccountId, receiver: AccountId, amount: U128) -> Promise {
        let _ = (token, receiver, amount);
        todo!("S-2.10")
    }
    pub(crate) fn storage_deposit(&self, token: AccountId, account: AccountId) -> Promise {
        let _ = (token, account);
        todo!("S-2.10")
    }
}

#[near]
impl Contract {
    /// On failure: status back to Accepted, balance restored.
    #[private]
    pub fn on_claim_paid(&mut self, #[callback_result] result: Result<(), PromiseError>, tip_id: TipId, amount: U128) {
        let _ = (result, tip_id, amount);
        todo!("S-2.10")
    }
}
