//! Owner: rotate relayers and keeper ONLY. Never funds or tips. (S-2.9)

use near_sdk::{near, AccountId};

use crate::types::X25519PublicKey;
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    pub fn set_relayers(&mut self, relayers: Vec<AccountId>) {
        let _ = relayers;
        todo!("S-2.9")
    }
    pub fn set_keeper(&mut self, keeper: AccountId, keeper_x25519_pub: X25519PublicKey) {
        let _ = (keeper, keeper_x25519_pub);
        todo!("S-2.9")
    }
}
