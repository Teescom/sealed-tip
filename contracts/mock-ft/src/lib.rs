//! tUSDC mock token for testnet and sandbox only (A-1.5).
//! Implements NEP-141 + NEP-145 via near-contract-standards (approved 2026-11-04), plus open `mint`.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    decimals: u8,
}

#[near]
impl MockFt {
    #[init]
    pub fn new() -> Self {
        Self { decimals: 6 }
    }

    /// Open mint — testnet only.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        let _ = (account_id, amount);
        todo!("A-1.5")
    }
}
