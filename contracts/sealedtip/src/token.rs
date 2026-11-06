//! NEP-141 promise builders and their rollback callbacks. (S-2.10)
//!
//! Two rules from AGENTS.md shape this file. Every `ft_transfer` this contract makes is followed by
//! a callback that undoes the state change if the token refuses it — a funder whose withdrawal
//! failed must not also lose the balance the contract already debited. And the state is written
//! *before* the promise is built, so a re-entrant call can never spend the same money twice.
//!
//! The claim-side promises (`ft_transfer` + `storage_deposit` + gas drip, with the rollback that
//! puts a tip back to `Accepted`) belong to S-3.5, where `claim` exists to call them from.

use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, Promise, PromiseError};

use crate::errors::E30_BALANCE_OVERFLOW;
use crate::types::{ProgrammeId, TipId};
use crate::{Contract, ContractExt};

/// `ft_transfer` needs ~5 TGas in the reference token; 10 covers one that also maintains
/// allowances or storage, without letting a slow token consume the whole attachable budget.
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
/// The rollback adds one number back. It has to be affordable even when the transfer itself failed.
const GAS_FOR_WITHDRAW_ROLLBACK: Gas = Gas::from_tgas(5);

/// Declared here rather than imported from `near-contract-standards`: ARCHITECTURE §2 scopes that
/// crate to `mock-ft`, and all we need is the one method signature and its JSON serialization.
#[ext_contract(ext_nep141)]
pub trait Nep141 {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

impl Contract {
    /// Sends `amount` of `token` back to `funder`, then calls `on_withdraw_paid`.
    /// `take_withdraw` has already debited the programme, so the balance is only correct after the
    /// callback has run — on success it is a no-op, on failure it puts `amount` back.
    pub(crate) fn withdraw_transfer_promise(
        &mut self,
        programme_id: ProgrammeId,
        token: AccountId,
        funder: AccountId,
        amount: U128,
    ) -> Promise {
        ext_nep141::ext(token)
            // NEP-141 requires exactly 1 yoctoNEAR on `ft_transfer`, and the token forwards no
            // deposit of its own, so this is carried from the programme's `ops_balance`.
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(
                funder,
                amount,
                Some(format!("sealedtip withdraw from programme {programme_id}")),
            )
            .then(
                Contract::ext_self()
                    .with_static_gas(GAS_FOR_WITHDRAW_ROLLBACK)
                    .on_withdraw_paid(programme_id, amount),
            )
    }
}

#[near]
impl Contract {
    /// The withdrawal was refused: restore what `take_withdraw` removed. Runs only as our own
    /// callback (`#[private]`), because anyone able to call it could inflate a balance.
    #[private]
    pub fn on_withdraw_paid(
        &mut self,
        #[callback_result] result: Result<(), PromiseError>,
        programme_id: ProgrammeId,
        amount: U128,
    ) {
        if result.is_err() {
            let programme = self.need_programme(programme_id);
            programme.balance.0 = programme
                .balance
                .0
                .checked_add(amount.0)
                .unwrap_or_else(|| env::panic_str(E30_BALANCE_OVERFLOW));
        }
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{as_caller, contract_with, funder, programme_balances, token};
    use crate::types::ProgrammeId;

    const PROGRAMME: ProgrammeId = 7;

    /// Programme 7 holding `balance` with `reserved` already committed to tips under review.
    fn contract_with_balances(balance: u128, reserved: u128) -> Contract {
        let mut programme = programme_balances(balance, reserved);
        programme.id = PROGRAMME;
        contract_with(vec![programme], vec![])
    }

    fn balance(contract: &Contract) -> u128 {
        contract
            .programmes
            .get(&PROGRAMME)
            .expect("programme")
            .balance
            .0
    }

    #[test]
    fn a_refused_transfer_puts_the_debited_amount_back() {
        let mut contract = contract_with_balances(1_000, 300);
        contract.on_withdraw_paid(Err(PromiseError::Failed), PROGRAMME, U128(700));
        assert_eq!(balance(&contract), 1_700);
    }

    /// The mirror case: if the callback restored on success too, the funder would be paid twice.
    #[test]
    fn an_accepted_transfer_leaves_the_debit_in_place() {
        let mut contract = contract_with_balances(1_000, 300);
        contract.on_withdraw_paid(Ok(()), PROGRAMME, U128(700));
        assert_eq!(balance(&contract), 1_000);
    }

    /// The pair the token actually sees: debit first, then the callback decides whether it stands.
    #[test]
    fn withdraw_then_a_failed_transfer_leaves_state_untouched() {
        let mut contract = contract_with_balances(1_000, 300);
        as_caller(funder());
        let _ = contract.withdraw_unreserved(PROGRAMME, U128(700));
        assert_eq!(balance(&contract), 300, "the debit happens before the call");
        contract.on_withdraw_paid(Err(PromiseError::Failed), PROGRAMME, U128(700));
        assert_eq!(balance(&contract), 1_000);
        assert_eq!(
            contract.programmes.get(&PROGRAMME).unwrap().reserved,
            U128(300),
            "a withdrawal never touches what a tip under review already committed"
        );
    }

    #[test]
    #[should_panic(expected = "E01_PROGRAMME_NOT_FOUND")]
    fn the_callback_cannot_credit_a_programme_that_does_not_exist() {
        let mut contract = contract_with_balances(1_000, 0);
        contract.on_withdraw_paid(Err(PromiseError::Failed), 99, U128(1));
    }

    #[test]
    #[should_panic(expected = "E30_BALANCE_OVERFLOW")]
    fn a_restore_that_would_wrap_is_refused() {
        let mut contract = contract_with_balances(u128::MAX, 0);
        contract.on_withdraw_paid(Err(PromiseError::Failed), PROGRAMME, U128(1));
    }

    /// Building the promise is the other half of `withdraw_unreserved`. A unit test can only check
    /// that the chain is well formed — that the call resolves against a real token is what
    /// `tests/programmes.rs` proves over RPC.
    #[test]
    fn the_withdraw_call_is_built_without_panicking() {
        let mut contract = contract_with_balances(1_000, 0);
        as_caller(funder());
        let _ = contract.withdraw_transfer_promise(PROGRAMME, token(), funder(), U128(500));
        assert_eq!(
            balance(&contract),
            1_000,
            "building a promise must not itself move money — only `take_withdraw` does"
        );
    }
}
