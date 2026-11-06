//! Claim (relayer, signed by tipster): storage_deposit + gas drip + ft_transfer. (S-3.5)
//!
//! The payout destination is part of what the tipster signs, so a relayer cannot redirect a reward
//! it only forwards. Everything else about this method is about what happens when the money *almost*
//! moves: the state is written first, the promises second, and `on_claim_paid` (S-2.10) decides
//! whether the write stands.

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{env, near, AccountId, NearToken, PromiseOrValue};

use crate::access;
use crate::errors::{
    E02_TIP_NOT_FOUND, E14_INVALID_STATUS, E30_BALANCE_OVERFLOW, E32_OPS_BALANCE_TOO_LOW,
};
use crate::events::{emit, SealedTipEvent};
use crate::types::{Action, Payout, TipId, TipStatus};
use crate::{Contract, ContractExt};

/// What this contract attaches to the token's `storage_deposit` when it registers a payout
/// destination, in yoctoNEAR: 1.25 mNEAR.
///
/// A deposit has to be a number the contract knows before it builds the promise, and the token's own
/// `storage_balance_bounds` is a view we cannot read mid-transaction without yielding the whole claim
/// to a second round trip. So it is a constant, and `tests/claims.rs` pins it against the *deployed*
/// token's reported minimum rather than against a comment: if the two ever disagree, the test fails
/// here instead of a tipster finding their claim refused on testnet.
///
/// The number itself is `storage_byte_cost` times the bytes the mock token needs for one ledger
/// entry, measured on the wasm in `target/near/mock_ft` — which is what it is derived from on chain,
/// so it is the token build that is priced here, not a guess about NEAR in general. Swapping the
/// token (a real USDC on mainnet) means re-measuring it, and the swap is already the moment the pin
/// test starts failing rather than the moment a claim does.
///
/// The direction of a disagreement matters and is why exactness beats margin. Attach too little and
/// `storage_deposit` panics, the transfer behind it never runs, and the claim rolls back — a loud,
/// retryable refusal. Attach too much and the token refunds the surplus *to this contract*, where it
/// leaves `ops_balance` bookkeeping while staying in the account's NEAR balance, which is a slow leak
/// nobody can withdraw. A refused claim is a better failure than an unaccountable one.
pub const STORAGE_DEPOSIT: NearToken = NearToken::from_micronear(1250);

impl Contract {
    /// The destination a token transfer has to reach, whichever payout the tipster chose.
    ///
    /// A `Payout::Intents` destination is 1Click's account on this chain, not the tipster's, so it
    /// gets the reward and no NEAR: funding somebody else's account from the escrow would spend the
    /// programme's `ops_balance` to create a link between this claim and an account nobody here
    /// controls. The drip exists to let a *tipster* move their reward, and an Intents payout is moved
    /// by 1Click, not by them.
    fn receiver(payout: &Payout) -> AccountId {
        match payout {
            Payout::Near { account } => account.clone(),
            Payout::Intents {
                deposit_address, ..
            } => deposit_address.clone(),
        }
    }
}

#[near]
impl Contract {
    /// Relayer, signed by the tipster. Pays the reward the panel accepted, to the address the
    /// tipster signed, and spends the programme's NEAR on the storage deposit that makes the token
    /// transfer legal and the gas drip that makes the reward spendable.
    pub fn claim(
        &mut self,
        tip_id: TipId,
        payout: Payout,
        nonce: u64,
        signature: Base64VecU8,
    ) -> PromiseOrValue<()> {
        access::assert_relayer(self);

        // `Accepted` carries the reward, so reading it is the same lookup as the status rule: a tip
        // the DAO has not accepted has no number to pay, and a tip already `Paid` has nothing left.
        // This runs before the signature on purpose — it is the cheaper check, and the status of a
        // tip is public, so a caller needs no key at all to trip it.
        let (programme_id, reward) = {
            let tip = self
                .tips
                .get(&tip_id)
                .unwrap_or_else(|| env::panic_str(E02_TIP_NOT_FOUND));
            match tip.status {
                TipStatus::Accepted { reward } => (tip.programme_id, reward.0),
                _ => env::panic_str(E14_INVALID_STATUS),
            }
        };

        // The payout is inside the signed payload, so this is the line that makes "a relayer cannot
        // redirect a reward" true rather than merely intended. The three things read afterwards —
        // whether the destination is a tipster's own account, who receives the token, and the 1Click
        // memo — are all taken here, before `payout` moves into the action.
        let (payout_is_near, receiver, memo) = (
            matches!(payout, Payout::Near { .. }),
            Self::receiver(&payout),
            match &payout {
                Payout::Intents { memo, .. } => memo.clone(),
                Payout::Near { .. } => None,
            },
        );
        self.assert_signed(tip_id, nonce, Action::Claim { payout }, &signature);

        // A reward of nothing is still a decision — a DAO can accept a tip as credible and vote it
        // worth 0 — and the tipster has to be able to close it out. Paying nothing needs no storage
        // deposit, no drip and no transfer, so it settles in this transaction and spends no NEAR.
        if reward == 0 {
            let tip = self.need_tip(tip_id);
            tip.nonce = nonce;
            tip.status = TipStatus::Paid;
            emit(SealedTipEvent::TipPaid {
                tip_id,
                amount: U128(0),
            });
            return PromiseOrValue::Value(());
        }

        // The deposit is the part a claim cannot do without: an unregistered receiver makes the token
        // refuse the transfer, so the whole chain would roll back. The drip is a courtesy, and a
        // courtesy does not get to block a payout — it shrinks to what the programme can still afford
        // rather than refusing the claim.
        let (token, drip) = {
            let programme = self.need_programme(programme_id);
            let wanted = if payout_is_near {
                programme.gas_drip
            } else {
                NearToken::from_yoctonear(0)
            };
            // `min` rather than a check: the drip is the part a claim can shrink, and how far it can
            // shrink is exactly the NEAR left after the deposit has been paid for. That subtraction is
            // also the deposit floor in one place — a programme that cannot pay it has no more claims
            // in it, and E32 says so instead of letting the token refuse the transfer later.
            let affordable = programme
                .ops_balance
                .checked_sub(STORAGE_DEPOSIT)
                .unwrap_or_else(|| env::panic_str(E32_OPS_BALANCE_TOO_LOW));
            (programme.token.clone(), wanted.min(affordable))
        };

        // State before external calls (AGENTS), and every number this method can move moves here:
        // the escrow debit, the NEAR that pays for the deposit and the drip, the spent nonce and the
        // status. If the token refuses, `on_claim_paid` puts the escrow and the status back; it does
        // not refund the NEAR, because the deposit and the drip were really paid.
        {
            let programme = self.need_programme(programme_id);
            programme.ops_balance = programme
                .ops_balance
                .checked_sub(STORAGE_DEPOSIT)
                .and_then(|left| left.checked_sub(drip))
                .unwrap_or_else(|| env::panic_str(E32_OPS_BALANCE_TOO_LOW));
            programme.balance.0 = programme
                .balance
                .0
                .checked_sub(reward)
                .unwrap_or_else(|| env::panic_str(E30_BALANCE_OVERFLOW));
        }
        let tip = self.need_tip(tip_id);
        tip.nonce = nonce;
        tip.status = TipStatus::Paid;

        // `TipPaid` is not emitted here. The payout has not happened yet, and an event log that says a
        // tipster was paid while the token refused the transfer is the one thing a watcher must not
        // be able to be told twice. The callback emits it when the money is actually out.
        PromiseOrValue::Promise(self.claim_paid_promise(
            tip_id,
            token,
            receiver,
            U128(reward),
            memo,
            drip,
        ))
    }
}

/// The unit-test panic payload as text, so a test can assert on *which* refusal happened rather than
/// only that something panicked. `env::panic_str` carries a `String`; anything else gets its debug
/// form so an unexpected payload still prints something useful in the assertion failure.
#[cfg(test)]
fn panic_text(error: Box<dyn std::any::Any + Send>) -> String {
    if let Some(text) = error.downcast_ref::<String>() {
        text.clone()
    } else if let Some(text) = error.downcast_ref::<&str>() {
        (*text).to_string()
    } else {
        format!("{error:?}")
    }
}

/// Run `f`, expecting it to panic with `code`, and return the panic text so a test can also assert on
/// what state was *left behind* — which is half of what a rollback rule is about.
#[cfg(test)]
fn expect_refusal<R>(code: &str, f: impl FnOnce() -> R) -> String {
    let error = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(_) => panic!("expected a refusal with {code}, but the call returned"),
        Err(payload) => panic_text(payload),
    };
    assert!(error.contains(code), "expected {code}, got {error}");
    error
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{
        as_caller, claim_pubkey, contract_with, funder, keeper, make_programme, member_1,
        relayer_1, relayer_2, sign_action, tip_with_status, token,
    };
    use crate::types::{Programme, Tip, TipStatus};
    use near_sdk::NearToken;
    use near_sdk::PromiseError;

    const TIP: TipId = 0;
    const PROGRAMME: u64 = 0;
    const OPS: NearToken = NearToken::from_near(1);
    /// `make_programme`'s gas drip.
    const DRIP: NearToken = NearToken::from_millinear(50);

    /// yoctoNEAR arithmetic: `NearToken` deliberately has no `+`/`-` operators, so the fixtures do
    /// their sums in the integer the type wraps and convert back at the end.
    fn y(t: NearToken) -> u128 {
        t.as_yoctonear()
    }

    /// A tipster's own destination, in the shape a wallet actually makes one: an implicit account,
    /// i.e. 64 hex characters and nothing else, which does not exist on chain until the gas drip
    /// creates it.
    fn near_payout() -> Payout {
        Payout::Near {
            account: "0a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20212223242526272829"
                .parse()
                .unwrap(),
        }
    }

    fn intents_payout() -> Payout {
        Payout::Intents {
            deposit_address: "intents-deposit.testnet".parse().unwrap(),
            memo: Some("q-1234".to_string()),
        }
    }

    /// Programme 0 with an accepted tip at `reward` and the reservation `triage` made still held.
    fn contract_with_accepted(reward: u128, ops: NearToken) -> Contract {
        let mut programme = make_programme();
        programme.ops_balance = ops;
        programme.balance = U128(1_000);
        programme.reserved = U128(reward);
        let tip = tip_with_status(
            TIP,
            PROGRAMME,
            TipStatus::Accepted {
                reward: U128(reward),
            },
        );
        contract_with(vec![programme], vec![tip])
    }

    fn signed_claim(nonce: u64, payout: &Payout) -> Base64VecU8 {
        sign_action(
            TIP,
            nonce,
            Action::Claim {
                payout: payout.clone(),
            },
        )
    }

    fn ops(contract: &Contract) -> NearToken {
        contract.programmes.get(&PROGRAMME).unwrap().ops_balance
    }

    fn money(contract: &Contract) -> (u128, u128) {
        let p = contract.programmes.get(&PROGRAMME).unwrap();
        (p.balance.0, p.reserved.0)
    }

    fn status(contract: &Contract) -> TipStatus {
        contract.tips.get(&TIP).unwrap().status.clone()
    }

    fn paid_events() -> usize {
        // `events::emit` logs the NEP-297 name in snake_case, so matching on the variant's Rust name
        // would silently count zero events in every test below.
        near_sdk::test_utils::get_logs()
            .iter()
            .filter(|line| line.contains("\"event\":\"tip_paid\""))
            .count()
    }

    /// The happy path, as far as a unit test can see it: every number moved, the promise built, and
    /// no event yet because the transfer has not been answered.
    #[test]
    fn a_claim_debits_the_reward_and_the_ops_balance_before_any_call() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(relayer_1());
        let payout = near_payout();
        let signature = signed_claim(1, &payout);
        let result = contract.claim(TIP, payout, 1, signature);
        assert!(
            matches!(result, PromiseOrValue::Promise(_)),
            "a paid claim returns a promise"
        );
        assert_eq!(money(&contract), (800, 200), "the escrow debit lands first");
        assert_eq!(
            y(ops(&contract)),
            y(OPS) - y(STORAGE_DEPOSIT) - y(DRIP),
            "the deposit and the drip are spent out of the programme's NEAR"
        );
        assert_eq!(status(&contract), TipStatus::Paid);
        assert_eq!(contract.tips.get(&TIP).unwrap().nonce, 1);
        assert_eq!(
            paid_events(),
            0,
            "the payout has not happened yet, so a watcher must not be told it did"
        );
    }

    #[test]
    #[should_panic(expected = "E04_NOT_RELAYER")]
    fn a_claim_forwarded_by_anybody_else_is_refused() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(funder());
        let payout = near_payout();
        let signature = signed_claim(1, &payout);
        let _ = contract.claim(TIP, payout, 1, signature);
    }

    /// Neither the keeper nor the panel can settle a claim on the tipster's behalf; the two roles
    /// that touch a payout are the relayer that forwards it and this contract's own callback.
    #[test]
    #[should_panic(expected = "E04_NOT_RELAYER")]
    fn a_panel_member_cannot_forward_a_claim() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(member_1());
        let payout = near_payout();
        let signature = signed_claim(1, &payout);
        let _ = contract.claim(TIP, payout, 1, signature);
    }

    /// The status rule runs before the signature, so these all report E14 even though every one of
    /// them is signed by the right key with the right nonce: the thing being refused is the state,
    /// not the authority.
    #[test]
    fn only_an_accepted_tip_can_be_claimed() {
        for status in [
            TipStatus::Submitted,
            TipStatus::Dismissed,
            TipStatus::UnderReview,
            TipStatus::Unfunded,
            TipStatus::Rejected,
            TipStatus::Retracted,
            TipStatus::Paid,
        ] {
            let mut contract = contract_with(
                vec![make_programme()],
                vec![tip_with_status(TIP, PROGRAMME, status.clone())],
            );
            as_caller(relayer_2());
            let payout = near_payout();
            let signature = signed_claim(1, &payout);
            expect_refusal("E14_INVALID_STATUS", || {
                let _ = contract.claim(TIP, payout, 1, signature);
            });
        }
    }

    #[test]
    #[should_panic(expected = "E02_TIP_NOT_FOUND")]
    fn a_claim_for_a_tip_that_does_not_exist_is_refused() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(relayer_1());
        let payout = near_payout();
        let signature = sign_action(
            7_777,
            1,
            Action::Claim {
                payout: payout.clone(),
            },
        );
        let _ = contract.claim(7_777, payout, 1, signature);
    }

    /// The redirect case: a valid signature over one destination, presented with another. This is
    /// the rule PRD F8 exists for, so it is refused by the same E09 as any other bad signature.
    #[test]
    #[should_panic(expected = "E09_BAD_SIGNATURE")]
    fn a_signature_over_a_different_payout_is_refused() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(relayer_1());
        let honest = near_payout();
        let signature = signed_claim(1, &honest);
        let _ = contract.claim(TIP, intents_payout(), 1, signature);
    }

    #[test]
    #[should_panic(expected = "E10_BAD_NONCE")]
    fn a_replayed_nonce_cannot_pay_twice() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(relayer_1());
        let payout = near_payout();
        let signature = signed_claim(0, &payout);
        let _ = contract.claim(TIP, payout, 0, signature);
    }

    /// An Intents payout gets no NEAR: the destination is 1Click's account, not the tipster's, and
    /// funding it would spend the programme and link the claim to an account nobody here controls.
    #[test]
    fn an_intents_payout_spends_the_deposit_but_no_gas_drip() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(relayer_1());
        let payout = intents_payout();
        let signature = signed_claim(1, &payout);
        let _ = contract.claim(TIP, payout, 1, signature);
        assert_eq!(
            y(ops(&contract)),
            y(OPS) - y(STORAGE_DEPOSIT),
            "the drip is the part an Intents destination does not need"
        );
    }

    /// A programme whose NEAR has run down still pays: the deposit is all that is required, so the
    /// drip shrinks to the remainder instead of refusing the reward.
    #[test]
    fn a_short_gas_drip_shrinks_instead_of_blocking_the_payout() {
        let short = NearToken::from_yoctonear(y(STORAGE_DEPOSIT) + 10);
        let mut contract = contract_with_accepted(200, short);
        as_caller(relayer_1());
        let payout = near_payout();
        let signature = signed_claim(1, &payout);
        let _ = contract.claim(TIP, payout, 1, signature);
        assert_eq!(ops(&contract), NearToken::from_yoctonear(0));
        assert_eq!(money(&contract), (800, 200));
        assert_eq!(status(&contract), TipStatus::Paid);
    }

    /// Without the deposit the transfer cannot land at all, so this is the one NEAR shortage that
    /// refuses rather than degrades — and it refuses before spending anything.
    #[test]
    fn a_programme_that_cannot_pay_for_storage_is_refused() {
        let thin = NearToken::from_yoctonear(y(STORAGE_DEPOSIT) - 1);
        let mut contract = contract_with_accepted(200, thin);
        as_caller(relayer_1());
        let payout = near_payout();
        let signature = signed_claim(1, &payout);
        expect_refusal("E32_OPS_BALANCE_TOO_LOW", || {
            let _ = contract.claim(TIP, payout, 1, signature);
        });
        // A panic in a unit test unwinds the same call stack, so the contract is still the one the
        // refusal saw — which is what makes "it refused before spending" testable at all.
        assert_eq!(
            money(&contract),
            (1_000, 200),
            "a refused claim moves no money"
        );
        assert_eq!(ops(&contract), thin, "and spends no NEAR");
        assert_eq!(contract.tips.get(&TIP).unwrap().nonce, 0, "or nonce");
        assert_eq!(status(&contract), TipStatus::Accepted { reward: U128(200) });
    }

    /// `claim` returns a value rather than a promise when there is nothing to send, which is the
    /// only way a zero-reward tip can leave `Accepted` at all: `retract` refuses it, and a tipster
    /// who cannot claim and cannot retract is stuck in the DAO's decision forever.
    #[test]
    fn a_zero_reward_claim_settles_the_tip_and_spends_nothing() {
        let mut contract = contract_with_accepted(0, OPS);
        as_caller(relayer_1());
        let payout = near_payout();
        let signature = signed_claim(1, &payout);
        let result = contract.claim(TIP, payout, 1, signature);
        assert!(
            matches!(result, PromiseOrValue::Value(())),
            "nothing to send, so nothing to promise"
        );
        assert_eq!(status(&contract), TipStatus::Paid);
        assert_eq!(y(ops(&contract)), y(OPS));
        assert_eq!(money(&contract), (1_000, 0));
    }

    // --- on_claim_paid (S-2.10) ---------------------------------------------------------------

    /// Success: the money is out, so the reservation that was holding it is released and the event
    /// that says "paid" is finally emitted.
    #[test]
    fn a_successful_claim_releases_the_reservation_and_emits_once() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(relayer_1());
        let payout = near_payout();
        let signature = signed_claim(1, &payout);
        let _ = contract.claim(TIP, payout, 1, signature);
        let before = paid_events();
        contract.on_claim_paid(Ok(()), TIP, U128(200));
        assert_eq!(
            money(&contract),
            (800, 0),
            "the 200 has left the escrow, so it must stop blocking the funder"
        );
        assert_eq!(status(&contract), TipStatus::Paid);
        assert_eq!(
            paid_events() - before,
            1,
            "the payout event belongs to the callback"
        );
    }

    /// Failure: the escrow and the status come back, the reservation stays exactly where `triage`
    /// left it, and the NEAR already spent on the deposit stays spent.
    #[test]
    fn a_refused_transfer_returns_the_tip_to_accepted_and_keeps_the_money_committed() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(relayer_1());
        let payout = near_payout();
        let signature = signed_claim(1, &payout);
        let _ = contract.claim(TIP, payout, 1, signature);
        let ops_after_claim = ops(&contract);
        let before = paid_events();
        contract.on_claim_paid(Err(PromiseError::Failed), TIP, U128(200));
        assert_eq!(money(&contract), (1_000, 200), "the reward is not paid");
        assert_eq!(status(&contract), TipStatus::Accepted { reward: U128(200) });
        assert_eq!(
            ops(&contract),
            ops_after_claim,
            "the deposit was really spent"
        );
        assert_eq!(
            paid_events(),
            before,
            "a payout that did not happen is not in the log"
        );
    }

    /// The retry the rollback exists for: the tipster's next action carries nonce 2, and the second
    /// attempt pays. Two deposits were bought and only one reward left the escrow.
    #[test]
    fn a_rolled_back_claim_can_be_retried_with_the_next_nonce() {
        let mut contract = contract_with_accepted(200, OPS);
        as_caller(relayer_1());
        let payout = near_payout();
        let _ = contract.claim(TIP, payout.clone(), 1, signed_claim(1, &payout));
        contract.on_claim_paid(Err(PromiseError::Failed), TIP, U128(200));

        let _ = contract.claim(TIP, payout.clone(), 2, signed_claim(2, &payout));
        assert_eq!(
            y(ops(&contract)),
            y(OPS) - 2 * (y(STORAGE_DEPOSIT) + y(DRIP)),
            "each attempt pays for its own deposit, and none of it is refunded"
        );
        assert_eq!(money(&contract), (800, 200), "one debit stands");
        assert_eq!(status(&contract), TipStatus::Paid);
        contract.on_claim_paid(Ok(()), TIP, U128(200));
        assert_eq!(money(&contract), (800, 0));
    }

    #[test]
    #[should_panic(expected = "E02_TIP_NOT_FOUND")]
    fn the_callback_cannot_be_reached_for_a_tip_that_does_not_exist() {
        let mut contract = contract_with_accepted(200, OPS);
        contract.on_claim_paid(Ok(()), 4242, U128(200));
    }

    /// A claim whose debit would wrap the escrow is refused rather than wrapped: `balance` can only
    /// be lower than the reward if something else has already taken it, and the fix is to stop, not
    /// to carry.
    #[test]
    fn a_debit_that_would_wrap_is_refused() {
        let mut programme = make_programme();
        programme.balance = U128(100);
        programme.reserved = U128(200);
        programme.ops_balance = OPS;
        let tip = tip_with_status(TIP, PROGRAMME, TipStatus::Accepted { reward: U128(200) });
        let mut contract = contract_with(vec![programme], vec![tip]);
        as_caller(relayer_1());
        let payout = near_payout();
        let signature = signed_claim(1, &payout);
        expect_refusal("E30_BALANCE_OVERFLOW", || {
            let _ = contract.claim(TIP, payout, 1, signature);
        });
    }

    #[test]
    fn the_fixture_public_key_is_the_tipster_that_signed() {
        // Guards the fixtures themselves: if `claim_pubkey` and `sign_action` ever disagreed, every
        // E09 test above would be passing for the wrong reason.
        let tip: Tip = tip_with_status(TIP, PROGRAMME, TipStatus::Accepted { reward: U128(200) });
        assert_eq!(tip.claim_pubkey, claim_pubkey());
        let programme: Programme = make_programme();
        assert_eq!(programme.token, token());
        let _ = keeper();
    }
}
