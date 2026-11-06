//! NEP-141 promise builders and their rollback callbacks. (S-2.10)
//!
//! Two rules from AGENTS.md shape this file. Every `ft_transfer` this contract makes is followed by
//! a callback that undoes the state change if the token refuses it — a funder whose withdrawal
//! failed must not also lose the balance the contract already debited. And the state is written
//! *before* the promise is built, so a re-entrant call can never spend the same money twice.
//!
//! `withdraw_transfer_promise` is the withdrawal half and `claim_paid_promise` the payout half;
//! `on_withdraw_paid` and `on_claim_paid` are their two answers.

use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, Promise, PromiseError};

use crate::claim::STORAGE_DEPOSIT;
use crate::errors::E30_BALANCE_OVERFLOW;
use crate::events::{emit, SealedTipEvent};
use crate::types::{ProgrammeId, TipId, TipStatus};
use crate::{Contract, ContractExt};

/// `ft_transfer` needs ~5 TGas in the reference token; 10 covers one that also maintains
/// allowances or storage, without letting a slow token consume the whole attachable budget.
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
/// The rollback adds one number back. It has to be affordable even when the transfer itself failed.
const GAS_FOR_WITHDRAW_ROLLBACK: Gas = Gas::from_tgas(5);
/// Registering a destination is a storage write in somebody else's contract.
const GAS_FOR_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
/// The claim callback either releases a reservation or puts a debit back; both are two arithmetic
/// ops, and it is the step a failed payout depends on to undo the right thing.
const GAS_FOR_CLAIM_CALLBACK: Gas = Gas::from_tgas(10);

/// Declared here rather than imported from `near-contract-standards`: ARCHITECTURE §2 scopes that
/// crate to `mock-ft`, and all we need is the one method signature and its JSON serialization.
#[ext_contract(ext_nep141)]
pub trait Nep141 {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// NEP-147, the same reason. The return value is a `StorageBalance` we deliberately do not read:
/// nothing downstream depends on *how much* storage the destination ended up with, only that the
/// token will now accept a transfer to it.
#[ext_contract(ext_nep147)]
pub trait Nep147 {
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
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

    /// The three things a payout is made of, in the only order that works: register the
    /// destination, then transfer to it, then answer for the transfer.
    ///
    /// The deposit and the transfer are sequenced rather than run side by side because an
    /// unregistered receiver makes NEP-141 refuse the transfer, and a payout that fails for a reason
    /// as boring as that would look like a broken escrow. The gas drip is a plain NEAR transfer to
    /// the same account and runs alongside them: it can fail for nothing except a destination that
    /// is too cheap to create, and it is not what the callback is watching.
    pub(crate) fn claim_paid_promise(
        &mut self,
        tip_id: TipId,
        token: AccountId,
        receiver: AccountId,
        amount: U128,
        memo: Option<String>,
        drip: NearToken,
    ) -> Promise {
        let deposit = ext_nep147::ext(token.clone())
            .with_attached_deposit(STORAGE_DEPOSIT)
            .with_static_gas(GAS_FOR_STORAGE_DEPOSIT)
            // `registration_only`: make sure the destination can receive, and never top up a storage
            // balance it already chose for itself. Any surplus comes back to this contract, which is
            // why `claim` charges `ops_balance` the full constant either way.
            .storage_deposit(Some(receiver.clone()), Some(true));

        let memo = match memo {
            // The 1Click memo is the only place it can be recorded on chain, so it travels inside
            // the NEP-141 memo. Whether that is what a deposit address needs is exactly what the
            // $1 check (S-0.6) has not answered yet.
            Some(memo) => Some(format!("sealedtip claim {tip_id}: {memo}")),
            None => Some(format!("sealedtip claim {tip_id}")),
        };
        let transfer = ext_nep141::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(receiver.clone(), amount, memo);

        let callback = Contract::ext_self()
            .with_static_gas(GAS_FOR_CLAIM_CALLBACK)
            .on_claim_paid(tip_id, amount);

        if drip > NearToken::from_yoctonear(0) {
            // This is also what brings the fresh implicit account into existence: an address the
            // tipster generated locally has no account on chain until something funds it.
            Promise::new(receiver).transfer(drip).detach();
        }

        deposit.then(transfer).then(callback)
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

    /// The transfer was refused: the reward goes back into the escrow and the tip returns to the
    /// state the DAO left it in, so the tipster can try again with the next nonce.
    ///
    /// `ops_balance` is *not* restored. The storage deposit and the gas drip were really paid on
    /// chain — refunding them here would let one failing claim spend the programme over and over
    /// while reporting a balance that was never there.
    ///
    /// The nonce stays spent, which is the same rule `assert_signed` is built around in the other
    /// direction: a call the *contract* refused costs nothing, a call the token refused did use up
    /// the relayer's place in the sequence. The retry is a new action, not a replay.
    #[private]
    pub fn on_claim_paid(
        &mut self,
        #[callback_result] result: Result<(), PromiseError>,
        tip_id: TipId,
        amount: U128,
    ) {
        let programme_id = self.need_tip(tip_id).programme_id;
        if result.is_ok() {
            // The reward has left the escrow, so the reservation standing behind it is the same
            // money seen twice: once as a balance that is already gone and once as a withdrawal the
            // funder cannot make. Releasing it here is what keeps `reserved` meaning "committed to a
            // tip that has not been paid yet".
            self.release_reservation(programme_id, amount.0);
            emit(SealedTipEvent::TipPaid { tip_id, amount });
        } else {
            let programme = self.need_programme(programme_id);
            programme.balance.0 = programme
                .balance
                .0
                .checked_add(amount.0)
                .unwrap_or_else(|| env::panic_str(E30_BALANCE_OVERFLOW));
            let tip = self.need_tip(tip_id);
            tip.status = TipStatus::Accepted { reward: amount };
        }
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
