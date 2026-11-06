//! Owner: rotate relayers and keeper ONLY. Never funds or tips. (S-2.9)
//!
//! The owner is the one role that can stall the system, so its power is bounded twice: these two
//! methods are the only ones it can call (ARCHITECTURE §5 "can't touch funds or tips"), and the
//! relayer set cannot drop below two distinct accounts — one relayer is a single point of failure
//! that can censor every tipster action (B9).

use near_sdk::{near, require, AccountId};

use crate::access::assert_owner;
use crate::errors::E27_TOO_FEW_RELAYERS;
use crate::types::X25519PublicKey;
use crate::{Contract, ContractExt};

/// Same rule as the panel: a list is only ≥2 if it holds two different people.
fn distinct_relayers(relayers: &[AccountId]) -> usize {
    let mut sorted = relayers.to_vec();
    sorted.sort();
    sorted.dedup();
    sorted.len()
}

#[near]
impl Contract {
    pub fn set_relayers(&mut self, relayers: Vec<AccountId>) {
        assert_owner(self);
        require!(distinct_relayers(&relayers) >= 2, E27_TOO_FEW_RELAYERS);
        self.relayers = relayers;
    }

    /// Rotating the keeper resets its liveness proof: `keeper_last_seen` back to 0 means the new
    /// keeper has not heartbeated yet, which is true, rather than inheriting the old one's.
    pub fn set_keeper(&mut self, keeper: AccountId, keeper_x25519_pub: X25519PublicKey) {
        assert_owner(self);
        self.keeper = keeper;
        self.keeper_x25519_pub = keeper_x25519_pub;
        self.keeper_last_seen = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{
        acct, as_caller, contract_account, keeper, make_contract, owner, relayer_1, KEEPER_X25519,
    };

    fn relayers(list: &[AccountId]) -> Vec<AccountId> {
        list.to_vec()
    }

    #[test]
    fn the_owner_can_rotate_the_relayer_set() {
        let mut contract = make_contract();
        as_caller(owner());
        let fresh = [acct("relayer-3.testnet"), acct("relayer-4.testnet")];
        contract.set_relayers(relayers(&fresh));
        assert_eq!(contract.relayers, fresh.to_vec());
    }

    /// Not just "the caller is the owner": a rotation must not be able to smuggle in one relayer,
    /// because a single relayer can censor every tipster action.
    #[test]
    #[should_panic(expected = "E27_TOO_FEW_RELAYERS")]
    fn a_single_relayer_is_refused() {
        let mut contract = make_contract();
        as_caller(owner());
        contract.set_relayers(relayers(&[relayer_1()]));
    }

    #[test]
    #[should_panic(expected = "E27_TOO_FEW_RELAYERS")]
    fn an_empty_relayer_set_is_refused() {
        let mut contract = make_contract();
        as_caller(owner());
        contract.set_relayers(vec![]);
    }

    /// Two entries naming the same account would satisfy a raw `len() >= 2` while leaving one person
    /// able to both queue and drop every action.
    #[test]
    #[should_panic(expected = "E27_TOO_FEW_RELAYERS")]
    fn two_listings_of_one_relayer_are_not_two_relayers() {
        let mut contract = make_contract();
        as_caller(owner());
        contract.set_relayers(relayers(&[relayer_1(), relayer_1()]));
    }

    #[test]
    #[should_panic(expected = "E08_NOT_OWNER")]
    fn a_relayer_cannot_rotate_the_relayer_set() {
        let mut contract = make_contract();
        as_caller(relayer_1());
        contract.set_relayers(relayers(&[acct("a.testnet"), acct("b.testnet")]));
    }

    /// The contract account is what a promise callback runs as. If it passed the owner check, any
    /// method that chains a callback to itself could rewrite the relayer list.
    #[test]
    #[should_panic(expected = "E08_NOT_OWNER")]
    fn the_contract_itself_is_not_the_owner() {
        let mut contract = make_contract();
        as_caller(contract_account());
        contract.set_relayers(relayers(&[acct("a.testnet"), acct("b.testnet")]));
    }

    #[test]
    fn the_new_keeper_starts_unproven() {
        let mut contract = make_contract();
        contract.keeper_last_seen = 12345;
        as_caller(owner());
        contract.set_keeper(acct("keeper-2.testnet"), [9; 32]);
        assert_eq!(contract.keeper, acct("keeper-2.testnet"));
        assert_eq!(contract.keeper_x25519_pub, [9; 32]);
        assert_eq!(contract.keeper_last_seen, 0);
    }

    #[test]
    #[should_panic(expected = "E08_NOT_OWNER")]
    fn the_keeper_cannot_appoint_itself_a_successor() {
        let mut contract = make_contract();
        as_caller(keeper());
        contract.set_keeper(keeper(), KEEPER_X25519);
    }
}
