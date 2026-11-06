//! sealedtip: anonymous whistleblower rewards. Design: ARCHITECTURE.md · Structure: project_structure.md · Tasks: ROADMAP.md.

use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{near, AccountId, BorshStorageKey, PanicOnDefault, PromiseOrValue};

pub mod access;
pub mod actions;
pub mod admin;
pub mod claim;
pub mod errors;
pub mod events;
pub mod pow;
pub mod programme;
pub mod switch;
#[cfg(test)]
pub mod test_utils;
pub mod time;
pub mod tip;
pub mod token;
pub mod types;
pub mod views;

use types::{Programme, ProgrammeId, Tip, TipId, X25519PublicKey};

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Programmes,
    Tips,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub(crate) programmes: IterableMap<ProgrammeId, Programme>,
    pub(crate) tips: IterableMap<TipId, Tip>,
    /// Allow-listed relayers (≥2).
    pub(crate) relayers: Vec<AccountId>,
    pub(crate) keeper: AccountId,
    pub(crate) keeper_x25519_pub: X25519PublicKey,
    pub(crate) keeper_last_seen: u64,
    /// Can rotate relayers/keeper only — never touches funds or tips.
    pub(crate) owner: AccountId,
    pub(crate) next_programme_id: ProgrammeId,
    pub(crate) next_tip_id: TipId,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner: AccountId,
        relayers: Vec<AccountId>,
        keeper: AccountId,
        keeper_x25519_pub: X25519PublicKey,
    ) -> Self {
        Self {
            programmes: IterableMap::new(StorageKey::Programmes),
            tips: IterableMap::new(StorageKey::Tips),
            relayers,
            keeper,
            keeper_x25519_pub,
            keeper_last_seen: 0,
            owner,
            next_programme_id: 0,
            next_tip_id: 0,
        }
    }

    /// NEP-141 receiver. `msg` = `{"fund": programme_id}`; credits `balance` and retries
    /// reservations for `Unfunded` tips. Returns 0 — the whole transfer is taken, and a closed or
    /// missing programme panics instead, which makes the token refund the sender itself.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        // `sender_id` is deliberately unread: a funder's identity is not needed to credit a
        // programme (the tokens are already in our account) and must never reach an event.
        let _ = sender_id;
        self.fund(amount, msg);
        PromiseOrValue::Value(U128(0))
    }
}
