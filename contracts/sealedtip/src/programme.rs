//! Programmes (funder side). (S-2.6)
//!
//! Money model: `balance` is what the token has credited this programme and `reserved` is what a
//! panel member has already committed by marking a tip credible. A funder can only take back
//! `balance − reserved`, so a tip under review cannot be defunded (ARCHITECTURE §11 "Funder
//! reneges"). Submission reserves nothing; only triage does.

use near_sdk::env;
use near_sdk::json_types::{U128, U64};
use near_sdk::{near, require, AccountId, NearToken, Promise};

use crate::access::{assert_funder, assert_panel_dao};
use crate::errors::{
    E01_PROGRAMME_NOT_FOUND, E16_RESERVED_FUNDS, E17_PROGRAMME_CLOSED, E21_WRONG_TOKEN,
    E22_INVALID_MESSAGE, E24_INSUFFICIENT_DEPOSIT, E25_INVALID_TIME_SCALE, E26_RECEIVER_DEPOSIT,
    E28_TOO_FEW_PANEL_MEMBERS, E29_RESERVATION_UNDERFLOW, E30_BALANCE_OVERFLOW,
};
use crate::events::{emit, SealedTipEvent};
use crate::types::{CryptoHash, FtMessage, PanelMember, Programme, ProgrammeId, TipId, TipStatus};
use crate::{Contract, ContractExt};

/// `{"fund": 3}` and nothing else — a wrong shape must not silently fund programme 0.
fn parse_fund_message(msg: &str) -> ProgrammeId {
    near_sdk::serde_json::from_str::<FtMessage>(msg)
        .map(|message| match message {
            FtMessage::Fund(programme_id) => programme_id,
        })
        .unwrap_or_else(|_| env::panic_str(E22_INVALID_MESSAGE))
}

/// Panel and relayer lists are only meaningful without repeats: two entries for one account would
/// satisfy "≥2" while leaving one person able to both review and release a tip.
pub(crate) fn distinct_accounts(members: &[PanelMember]) -> usize {
    let mut accounts: Vec<AccountId> = members
        .iter()
        .map(|member| member.account.clone())
        .collect();
    accounts.sort();
    accounts.dedup();
    accounts.len()
}

impl Contract {
    pub(crate) fn need_programme(&mut self, programme_id: ProgrammeId) -> &mut Programme {
        self.programmes
            .get_mut(&programme_id)
            .unwrap_or_else(|| env::panic_str(E01_PROGRAMME_NOT_FOUND))
    }

    /// Commit `amount` against the programme. False when the funds are not there — which is what
    /// puts a credible tip into `Unfunded`. S-3.2 calls this at triage; `fund` retries it.
    pub(crate) fn try_reserve(&mut self, programme_id: ProgrammeId, amount: u128) -> bool {
        let programme = self.need_programme(programme_id);
        if amount > programme.balance.0.saturating_sub(programme.reserved.0) {
            return false;
        }
        programme.reserved.0 = programme
            .reserved
            .0
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str(E30_BALANCE_OVERFLOW));
        true
    }

    /// The tip reached a decision, so the commitment is no longer needed (dismiss, reject, pay).
    /// `triage` and `resolve_tip` call it now; `claim` (S-3.5) is the caller that releases what an
    /// accepted tip actually paid.
    pub(crate) fn release_reservation(&mut self, programme_id: ProgrammeId, amount: u128) {
        let programme = self.need_programme(programme_id);
        require!(programme.reserved.0 >= amount, E29_RESERVATION_UNDERFLOW);
        programme.reserved.0 -= amount;
    }

    /// A funding event may finally pay for tips the panel believed while the programme was empty.
    /// Lowest tip id first, stopping at the first one that still does not fit.
    pub(crate) fn retry_unfunded(&mut self, programme_id: ProgrammeId) {
        let mut pending: Vec<TipId> = self
            .tips
            .iter()
            .filter(|(_, tip)| {
                tip.programme_id == programme_id && tip.status == TipStatus::Unfunded
            })
            .map(|(_, tip)| tip.id)
            .collect();
        if pending.is_empty() {
            return;
        }
        pending.sort_unstable();
        let max_reward = self.need_programme(programme_id).max_reward.0;
        for tip_id in pending {
            if !self.try_reserve(programme_id, max_reward) {
                break;
            }
            if let Some(tip) = self.tips.get_mut(&tip_id) {
                tip.status = TipStatus::UnderReview;
            }
            // AGENTS: every state change gets an event. This one is a status change nobody called
            // for — the tip became reviewable because money arrived, not because a member re-voted —
            // and a panel watching events is how it learns the tip is now actionable.
            emit(SealedTipEvent::TipTriaged {
                tip_id,
                credible: true,
            });
        }
    }

    /// NEP-141 receiver logic for `msg = {"fund": programme_id}`, kept out of `ft_on_transfer` so
    /// the accounting is testable without a live VM.
    pub(crate) fn fund(&mut self, amount: U128, msg: String) -> ProgrammeId {
        // `mock-ft` forwards no deposit (5.30's `ft_transfer_call` uses `with_unused_gas_weight(1)`
        // and never attaches), but NEP-141 senders may forward the 1 yoctoNEAR they were required to
        // attach. Anything above that is a caller trying to buy a reservation with NEAR, which this
        // contract does not price — so it is refused rather than silently dropped on the floor.
        let deposit = env::attached_deposit();
        require!(
            deposit == NearToken::from_yoctonear(0) || deposit == NearToken::from_yoctonear(1),
            E26_RECEIVER_DEPOSIT
        );
        let programme_id = parse_fund_message(&msg);
        let programme = self.need_programme(programme_id);
        require!(
            programme.token == env::predecessor_account_id(),
            E21_WRONG_TOKEN
        );
        programme.balance.0 = programme
            .balance
            .0
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str(E30_BALANCE_OVERFLOW));
        emit(SealedTipEvent::ProgrammeFunded {
            programme_id,
            amount,
        });
        self.retry_unfunded(programme_id);
        programme_id
    }

    /// Guards, then moves the money off the balance; returns where the transfer has to go.
    /// State is written before any promise is built (AGENTS "state before external calls").
    pub(crate) fn take_withdraw(
        &mut self,
        programme_id: ProgrammeId,
        amount: U128,
    ) -> (AccountId, AccountId) {
        let programme = self.need_programme(programme_id);
        assert_funder(programme);
        let unreserved = programme
            .balance
            .0
            .checked_sub(programme.reserved.0)
            .unwrap_or_else(|| env::panic_str(E29_RESERVATION_UNDERFLOW));
        require!(amount.0 <= unreserved, E16_RESERVED_FUNDS);
        programme.balance.0 -= amount.0;
        (programme.token.clone(), programme.funder.clone())
    }
}

#[near]
impl Contract {
    /// Attached NEAR becomes `ops_balance`: the budget for the `storage_deposit` calls and gas
    /// drips a claim needs. It has to cover at least one `gas_drip` (E24) — whether a *later* claim
    /// can also pay the token's storage deposit depends on that token and is checked at claim time
    /// (S-3.5), where `ops_balance` is debited and verified again.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn create_programme(
        &mut self,
        title: String,
        scope_uri: String,
        scope_hash: CryptoHash,
        panel_dao: AccountId,
        token: AccountId,
        max_reward: U128,
        gas_drip: NearToken,
        pow_bits: u8,
        time_scale: u32,
    ) -> ProgrammeId {
        require!(time_scale >= 1, E25_INVALID_TIME_SCALE);
        require!(
            gas_drip > NearToken::from_yoctonear(0),
            E24_INSUFFICIENT_DEPOSIT
        );
        let attached = env::attached_deposit();
        require!(attached >= gas_drip, E24_INSUFFICIENT_DEPOSIT);

        let funder = env::predecessor_account_id();
        let programme_id = self.next_programme_id;
        self.next_programme_id = programme_id + 1;
        self.programmes.insert(
            programme_id,
            Programme {
                id: programme_id,
                funder: funder.clone(),
                title,
                scope_uri,
                scope_hash,
                panel_dao,
                // The DAO appoints its own reviewers; a funder must not be able to pick them.
                panel: Vec::new(),
                token,
                max_reward,
                balance: U128(0),
                reserved: U128(0),
                ops_balance: attached,
                gas_drip,
                pow_bits,
                open: true,
                time_scale,
                created_at: U64(env::block_timestamp()),
            },
        );
        emit(SealedTipEvent::ProgrammeCreated {
            programme_id,
            funder,
        });
        programme_id
    }

    /// Only up to `balance − reserved` (E16). The funder is necessarily registered in the token —
    /// they had to be to transfer into the programme — so this is a plain `ft_transfer`, and the
    /// rollback callback puts the balance back if the token refuses it anyway.
    pub fn withdraw_unreserved(&mut self, programme_id: ProgrammeId, amount: U128) -> Promise {
        let (token, funder) = self.take_withdraw(programme_id, amount);
        self.withdraw_transfer_promise(programme_id, token, funder, amount)
    }

    /// Blocks new tips; reservations stay until each tip is resolved.
    pub fn close_programme(&mut self, programme_id: ProgrammeId) {
        let programme = self.need_programme(programme_id);
        assert_funder(programme);
        require!(programme.open, E17_PROGRAMME_CLOSED);
        programme.open = false;
        emit(SealedTipEvent::ProgrammeClosed { programme_id });
    }

    /// Panel DAO only. Rotation affects future tips only (B10), so no tip state is touched here.
    pub fn set_panel(&mut self, programme_id: ProgrammeId, members: Vec<PanelMember>) {
        let programme = self.need_programme(programme_id);
        assert_panel_dao(programme);
        require!(distinct_accounts(&members) >= 2, E28_TOO_FEW_PANEL_MEMBERS);
        programme.panel = members;
        emit(SealedTipEvent::PanelSet { programme_id });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{
        acct, as_caller, as_caller_with_deposit, contract_with, contract_with_programme, funder,
        keeper, make_contract, make_tip, member_1, member_2, panel, panel_dao, programme_balances,
        tip_with_status, token, HOUR_NS, MEMBER_X25519,
    };
    use crate::types::Tip;
    use near_sdk::test_utils::get_logs;

    const ONE_NEAR: NearToken = NearToken::from_near(1);
    const DRIP: NearToken = NearToken::from_millinear(50);

    fn create(contract: &mut Contract, gas_drip: NearToken, attached: NearToken) -> ProgrammeId {
        as_caller_with_deposit(funder(), attached);
        contract.create_programme(
            "Public fund".to_string(),
            "https://scope.example/rules".to_string(),
            [0x33; 32],
            panel_dao(),
            token(),
            U128(500),
            gas_drip,
            12,
            1,
        )
    }

    fn member(account: AccountId) -> PanelMember {
        PanelMember {
            account,
            x25519_pub: MEMBER_X25519,
        }
    }

    fn programme_of(contract: &Contract, programme_id: ProgrammeId) -> &Programme {
        contract.programmes.get(&programme_id).expect("programme")
    }

    fn tip_of(contract: &Contract, tip_id: TipId) -> &Tip {
        contract.tips.get(&tip_id).expect("tip")
    }

    fn logs_contain(needle: &str) -> bool {
        get_logs().iter().any(|log| log.contains(needle))
    }

    #[test]
    fn create_programme_credits_the_attachment_and_starts_empty() {
        let mut contract = make_contract();
        let programme_id = create(&mut contract, DRIP, ONE_NEAR);
        let programme = programme_of(&contract, programme_id);
        assert_eq!(programme.id, 0);
        assert_eq!(programme.funder, funder());
        assert_eq!(programme.balance, U128(0));
        assert_eq!(programme.reserved, U128(0));
        assert_eq!(programme.ops_balance, ONE_NEAR);
        assert_eq!(programme.gas_drip, DRIP);
        assert_eq!(programme.pow_bits, 12);
        assert!(programme.open);
        assert_eq!(programme.time_scale, 1);
        assert_eq!(programme.created_at, U64(HOUR_NS));
        // The funder cannot appoint the panel that will judge its own money.
        assert!(programme.panel.is_empty());
        assert_eq!(contract.next_programme_id, 1);
        assert!(logs_contain("\"event\":\"programme_created\""));
    }

    #[test]
    fn programme_ids_increase_and_both_are_readable() {
        let mut contract = make_contract();
        assert_eq!(create(&mut contract, DRIP, ONE_NEAR), 0);
        assert_eq!(create(&mut contract, DRIP, ONE_NEAR), 1);
        assert_eq!(contract.programmes.len(), 2);
        assert_eq!(programme_of(&contract, 1).title, "Public fund");
    }

    #[test]
    #[should_panic(expected = "E24_INSUFFICIENT_DEPOSIT")]
    fn create_programme_without_a_drip_worth_of_deposit_is_rejected() {
        let mut contract = make_contract();
        create(&mut contract, DRIP, NearToken::from_yoctonear(1));
    }

    #[test]
    #[should_panic(expected = "E24_INSUFFICIENT_DEPOSIT")]
    fn create_programme_needs_a_nonzero_gas_drip() {
        let mut contract = make_contract();
        create(&mut contract, NearToken::from_yoctonear(0), ONE_NEAR);
    }

    #[test]
    #[should_panic(expected = "E25_INVALID_TIME_SCALE")]
    fn create_programme_rejects_a_zero_time_scale() {
        let mut contract = make_contract();
        as_caller_with_deposit(funder(), ONE_NEAR);
        contract.create_programme(
            "t".to_string(),
            "s".to_string(),
            [0; 32],
            panel_dao(),
            token(),
            U128(1),
            DRIP,
            12,
            0,
        );
    }

    #[test]
    fn funding_adds_to_the_balance_and_keeps_the_whole_amount() {
        let mut contract = contract_with_programme();
        as_caller(token());
        assert_eq!(contract.fund(U128(250), r#"{"fund":0}"#.to_string()), 0);
        assert_eq!(programme_of(&contract, 0).balance, U128(1250));
        assert_eq!(programme_of(&contract, 0).reserved, U128(0));
        assert!(logs_contain("\"event\":\"programme_funded\""));
    }

    #[test]
    fn funding_pays_for_a_tip_the_programme_previously_could_not() {
        // A member already said "credible"; the programme was empty, so the tip went Unfunded.
        // Nothing is reserved here — that is what "the programme could not pay" means.
        let mut contract = contract_with(
            vec![programme_balances(100, 0)],
            vec![tip_with_status(0, 0, TipStatus::Unfunded)],
        );
        as_caller(token());
        contract.fund(U128(400), r#"{"fund":0}"#.to_string());
        assert_eq!(
            tip_of(&contract, 0).status,
            TipStatus::UnderReview,
            "a funding event must reserve for a tip the panel already believed"
        );
        assert_eq!(programme_of(&contract, 0).balance, U128(500));
        assert_eq!(programme_of(&contract, 0).reserved, U128(500));
    }

    #[test]
    fn funding_still_short_leaves_the_tip_unfunded() {
        let mut contract = contract_with(
            vec![programme_balances(0, 0)],
            vec![tip_with_status(0, 0, TipStatus::Unfunded)],
        );
        as_caller(token());
        contract.fund(U128(10), r#"{"fund":0}"#.to_string());
        assert_eq!(tip_of(&contract, 0).status, TipStatus::Unfunded);
        assert_eq!(programme_of(&contract, 0).reserved, U128(0));
    }

    #[test]
    fn funding_catches_up_several_unfunded_tips_in_id_order() {
        // Two tips need 500 each; 750 arriving can pay exactly one, and it must be the lower id.
        let mut contract = contract_with(
            vec![programme_balances(0, 0)],
            vec![
                tip_with_status(1, 0, TipStatus::Unfunded),
                tip_with_status(0, 0, TipStatus::Unfunded),
            ],
        );
        as_caller(token());
        contract.fund(U128(750), r#"{"fund":0}"#.to_string());
        assert_eq!(tip_of(&contract, 0).status, TipStatus::UnderReview);
        assert_eq!(tip_of(&contract, 1).status, TipStatus::Unfunded);
        assert_eq!(programme_of(&contract, 0).reserved, U128(500));
    }

    #[test]
    #[should_panic(expected = "E21_WRONG_TOKEN")]
    fn funding_from_a_different_token_is_rejected() {
        let mut contract = contract_with_programme();
        as_caller(acct("other-token.testnet"));
        contract.fund(U128(10), r#"{"fund":0}"#.to_string());
    }

    #[test]
    #[should_panic(expected = "E22_INVALID_MESSAGE")]
    fn funding_with_an_unrecognised_message_is_rejected() {
        let mut contract = contract_with_programme();
        as_caller(token());
        contract.fund(U128(10), r#"{"withdraw":0}"#.to_string());
    }

    #[test]
    #[should_panic(expected = "E22_INVALID_MESSAGE")]
    fn funding_with_a_non_json_message_is_rejected() {
        let mut contract = contract_with_programme();
        as_caller(token());
        contract.fund(U128(10), "fund".to_string());
    }

    #[test]
    #[should_panic(expected = "E01_PROGRAMME_NOT_FOUND")]
    fn funding_an_unknown_programme_is_rejected() {
        let mut contract = make_contract();
        as_caller(token());
        contract.fund(U128(10), r#"{"fund":7}"#.to_string());
    }

    #[test]
    #[should_panic(expected = "E26_RECEIVER_DEPOSIT")]
    fn funding_rejects_an_attached_near_deposit() {
        let mut contract = contract_with_programme();
        as_caller_with_deposit(token(), NearToken::from_millinear(1));
        contract.fund(U128(10), r#"{"fund":0}"#.to_string());
    }

    #[test]
    fn withdraw_takes_exactly_the_unreserved_part() {
        let mut contract = contract_with(vec![programme_balances(1000, 500)], vec![]);
        as_caller(funder());
        assert_eq!(contract.take_withdraw(0, U128(500)), (token(), funder()));
        assert_eq!(programme_of(&contract, 0).balance, U128(500));
        assert_eq!(programme_of(&contract, 0).reserved, U128(500));
    }

    #[test]
    #[should_panic(expected = "E16_RESERVED_FUNDS")]
    fn withdrawing_reserved_funds_fails() {
        let mut contract = contract_with(vec![programme_balances(1000, 500)], vec![]);
        as_caller(funder());
        contract.take_withdraw(0, U128(501));
    }

    #[test]
    #[should_panic(expected = "E03_NOT_FUNDER")]
    fn withdraw_is_funder_only() {
        let mut contract = contract_with_programme();
        as_caller(member_1());
        contract.take_withdraw(0, U128(1));
    }

    #[test]
    fn closing_a_programme_stops_new_tips_and_keeps_the_money() {
        let mut contract = contract_with(vec![programme_balances(1000, 500)], vec![make_tip()]);
        as_caller(funder());
        contract.close_programme(0);
        assert!(!programme_of(&contract, 0).open);
        assert_eq!(programme_of(&contract, 0).reserved, U128(500));
        assert!(logs_contain("\"event\":\"programme_closed\""));
    }

    #[test]
    #[should_panic(expected = "E17_PROGRAMME_CLOSED")]
    fn closing_twice_fails_so_the_event_is_never_double_emitted() {
        let mut contract = contract_with_programme();
        as_caller(funder());
        contract.close_programme(0);
        contract.close_programme(0);
    }

    #[test]
    #[should_panic(expected = "E03_NOT_FUNDER")]
    fn closing_is_funder_only() {
        let mut contract = contract_with_programme();
        as_caller(keeper());
        contract.close_programme(0);
    }

    #[test]
    fn the_panel_dao_appoints_the_panel() {
        let mut contract = contract_with_programme();
        as_caller(panel_dao());
        contract.set_panel(0, panel());
        assert_eq!(programme_of(&contract, 0).panel.len(), 3);
        assert!(logs_contain("\"event\":\"panel_set\""));
    }

    #[test]
    #[should_panic(expected = "E05_NOT_PANEL_DAO")]
    fn the_funder_cannot_appoint_the_panel() {
        let mut contract = contract_with_programme();
        as_caller(funder());
        contract.set_panel(0, panel());
    }

    #[test]
    #[should_panic(expected = "E28_TOO_FEW_PANEL_MEMBERS")]
    fn a_one_person_panel_is_rejected() {
        let mut contract = contract_with_programme();
        as_caller(panel_dao());
        contract.set_panel(0, vec![member(member_2())]);
    }

    #[test]
    #[should_panic(expected = "E28_TOO_FEW_PANEL_MEMBERS")]
    fn two_entries_for_one_account_are_not_two_members() {
        let mut contract = contract_with_programme();
        as_caller(panel_dao());
        contract.set_panel(0, vec![member(member_2()), member(member_2())]);
    }

    #[test]
    fn reserving_stops_at_the_unreserved_balance() {
        let mut contract = contract_with(vec![programme_balances(1000, 500)], vec![]);
        assert!(!contract.try_reserve(0, 501));
        assert_eq!(
            programme_of(&contract, 0).reserved,
            U128(500),
            "a refused reserve must not move the numbers"
        );
        assert!(contract.try_reserve(0, 500));
        assert_eq!(programme_of(&contract, 0).reserved, U128(1000));
        contract.release_reservation(0, 500);
        assert_eq!(programme_of(&contract, 0).reserved, U128(500));
    }

    #[test]
    #[should_panic(expected = "E29_RESERVATION_UNDERFLOW")]
    fn releasing_more_than_is_reserved_stops_instead_of_freeing_money() {
        let mut contract = contract_with(vec![programme_balances(1000, 100)], vec![]);
        contract.release_reservation(0, 101);
    }

    #[test]
    fn distinct_accounts_counts_people_not_entries() {
        assert_eq!(distinct_accounts(&panel()), 3);
        assert_eq!(
            distinct_accounts(&[member(member_2()), member(member_2())]),
            1
        );
        assert_eq!(distinct_accounts(&[]), 0);
    }
}
