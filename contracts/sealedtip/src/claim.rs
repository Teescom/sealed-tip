//! Claim (relayer, signed by tipster): storage_deposit + gas drip + ft_transfer. (S-3.5)

use near_sdk::json_types::Base64VecU8;
use near_sdk::{near, Promise};

use crate::types::{Payout, TipId};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    pub fn claim(&mut self, tip_id: TipId, payout: Payout, nonce: u64, signature: Base64VecU8) -> Promise {
        let _ = (tip_id, payout, nonce, signature);
        todo!("S-3.5")
    }
}
