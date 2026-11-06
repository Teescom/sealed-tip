//! Tip submission (relayer), triage (panel member), resolution (panel DAO), retract. (S-3.1–S-3.4)

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::{env, near, require, AccountId};

use crate::access;
use crate::actions::{self, assert_signature};
use crate::errors::{
    E01_PROGRAMME_NOT_FOUND, E02_TIP_NOT_FOUND, E11_POW_TOO_LOW, E12_TOO_FEW_SEALED_KEYS,
    E13_SEALED_TO_RECUSED, E14_INVALID_STATUS, E15_REWARD_TOO_HIGH, E17_PROGRAMME_CLOSED,
    E30_BALANCE_OVERFLOW, E31_REWARD_ON_REJECT,
};
use crate::events::{emit, SealedTipEvent};
use crate::pow;
use crate::time;
use crate::types::{
    Cid, CryptoHash, Ed25519PublicKey, Programme, ProgrammeId, SealedKey, Switch, SwitchInput, Tip,
    TipId, TipStatus,
};
use crate::{Contract, ContractExt};

impl Contract {
    /// The tip must exist: E02 rather than a silent no-op, because a caller that names a tip id we
    /// do not have is either confused or probing.
    pub(crate) fn need_tip(&mut self, tip_id: TipId) -> &mut Tip {
        self.tips
            .get_mut(&tip_id)
            .unwrap_or_else(|| env::panic_str(E02_TIP_NOT_FOUND))
    }

    /// A tip is only triageable while it is `Submitted`: one credible judgement per tip, and a
    /// re-triage after a decision would silently move money the DAO has already spoken about.
    fn is_submitted(tip: &Tip) -> bool {
        matches!(tip.status, TipStatus::Submitted)
    }

    /// The programme and tip behind `tip_id` together, for the guards that need both. They live in
    /// separate maps, so the two mutable borrows are of different fields and can coexist — which is
    /// what lets `assert_panel_member` take `(&Programme, &Tip)` as one call. Going through
    /// `need_programme`/`need_tip` here would not compile: each takes `&mut self`.
    fn programme_and_tip(&mut self, tip_id: TipId) -> (&mut Programme, &mut Tip) {
        let programme_id = self
            .tips
            .get(&tip_id)
            .unwrap_or_else(|| env::panic_str(E02_TIP_NOT_FOUND))
            .programme_id;
        let programme = self
            .programmes
            .get_mut(&programme_id)
            .unwrap_or_else(|| env::panic_str(E01_PROGRAMME_NOT_FOUND));
        let tip = self
            .tips
            .get_mut(&tip_id)
            .unwrap_or_else(|| env::panic_str(E02_TIP_NOT_FOUND));
        (programme, tip)
    }
}

/// Distinct panel members holding a sealed key. Two entries for one member is one member — the same
/// rule `set_panel` applies to the panel itself (E28): otherwise "≥2 keys" is satisfied by a
/// duplicate and the tip is really sealed to one person.
fn distinct_sealed_members(sealed_keys: &[SealedKey]) -> usize {
    let mut members: Vec<AccountId> = sealed_keys.iter().map(|k| k.member.clone()).collect();
    members.sort();
    members.dedup();
    members.len()
}

/// `SwitchInput` is what the tipster chose; `Switch` is what the contract tracks. `next_deadline`
/// is the one absolute timestamp in it, and it goes through `time::deadline` so demo mode compresses
/// the interval the same way every other deadline is (AGENTS: never compare raw durations).
fn arm_switch(input: SwitchInput, now_ns: u64, time_scale: u32) -> Switch {
    Switch {
        interval: input.interval,
        grace: input.grace,
        next_deadline: U64(time::deadline(now_ns, input.interval.0, time_scale)),
        bundle_key_for_keeper: input.bundle_key_for_keeper,
        includes_raw: input.includes_raw,
        triggered: false,
    }
}

#[near]
impl Contract {
    /// Relayer only. Checks PoW, signature, ≥2 sealed keys, none to recused members. Reserves nothing.
    #[allow(clippy::too_many_arguments)]
    pub fn submit_tip(
        &mut self,
        programme_id: ProgrammeId,
        claim_pubkey: Ed25519PublicKey,
        evidence_cid: Cid,
        evidence_hash: CryptoHash,
        sealed_keys: Vec<SealedKey>,
        recused: Vec<AccountId>,
        cleaning_report_hash: CryptoHash,
        attestation_hash: Option<CryptoHash>,
        switch: Option<SwitchInput>,
        pow_nonce: u64,
        signature: Base64VecU8,
    ) -> TipId {
        // Access control first, then the cheap deterministic checks, then the signature: an ed25519
        // verify is the most expensive refusal here, so it is the last thing a spam call reaches.
        access::assert_relayer(self);
        let (open, pow_bits, time_scale) = {
            let programme = self.need_programme(programme_id);
            (programme.open, programme.pow_bits, programme.time_scale)
        };
        require!(open, E17_PROGRAMME_CLOSED);
        require!(
            pow::check(&evidence_hash, pow_nonce, pow_bits),
            E11_POW_TOO_LOW
        );
        for sealed in &sealed_keys {
            require!(!recused.contains(&sealed.member), E13_SEALED_TO_RECUSED);
        }
        require!(
            distinct_sealed_members(&sealed_keys) >= 2,
            E12_TOO_FEW_SEALED_KEYS
        );
        // The tip id does not exist yet, so it is not in what the tipster signed.
        let message = actions::submit_message(programme_id, &evidence_hash, &claim_pubkey);
        assert_signature(&message, &signature, &claim_pubkey);

        let now_ns = env::block_timestamp();
        let tip_id = self.next_tip_id;
        let switch = switch.map(|input| arm_switch(input, now_ns, time_scale));
        let tip = Tip {
            id: tip_id,
            programme_id,
            claim_pubkey,
            nonce: 0,
            evidence_cid,
            evidence_hash,
            sealed_keys,
            recused,
            cleaning_report_hash,
            attestation_hash,
            switch,
            status: TipStatus::Submitted,
            submitted_at: U64(now_ns),
            triaged_by: None,
            released_keys: vec![],
        };
        // Invariant 1 (AGENTS): submission reserves nothing — no line here touches `reserved`.
        self.tips.insert(tip_id, tip);
        self.next_tip_id = tip_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str(E30_BALANCE_OVERFLOW));
        emit(SealedTipEvent::TipSubmitted {
            tip_id,
            programme_id,
        });
        tip_id
    }

    /// Non-recused panel member. credible → reserve max_reward (or Unfunded); else Dismissed.
    pub fn triage(&mut self, tip_id: TipId, credible: bool) {
        let caller = env::predecessor_account_id();
        let (programme_id, max_reward) = {
            let (programme, tip) = self.programme_and_tip(tip_id);
            access::assert_panel_member(programme, tip);
            require!(Self::is_submitted(tip), E14_INVALID_STATUS);
            (tip.programme_id, programme.max_reward.0)
        };

        if credible {
            // Short of funds is not "not credible": the judgement stands and the reservation is
            // retried by the next `fund` (S-3.9), so a panel is never asked to re-vote on money.
            let funded = self.try_reserve(programme_id, max_reward);
            let tip = self.need_tip(tip_id);
            tip.status = if funded {
                TipStatus::UnderReview
            } else {
                TipStatus::Unfunded
            };
            tip.triaged_by = Some(caller);
            emit(SealedTipEvent::TipTriaged {
                tip_id,
                credible: true,
            });
            if !funded {
                emit(SealedTipEvent::TipUnfunded { tip_id });
            }
        } else {
            // Nothing was reserved at submission, so a dismissal releases nothing (S-5.1).
            let tip = self.need_tip(tip_id);
            tip.status = TipStatus::Dismissed;
            tip.triaged_by = Some(caller);
            emit(SealedTipEvent::TipTriaged {
                tip_id,
                credible: false,
            });
            emit(SealedTipEvent::TipDismissed { tip_id });
        }
    }

    /// Panel DAO only. Accept: reward ≤ max_reward, release the unused reservation. Reject: release all.
    pub fn resolve_tip(&mut self, tip_id: TipId, accept: bool, reward: Option<U128>) {
        let (programme_id, max_reward) = {
            let (programme, tip) = self.programme_and_tip(tip_id);
            access::assert_panel_dao(programme);
            // Only `UnderReview` is resolvable. An `Unfunded` tip has no money behind it yet and a
            // DAO vote on it would promise what the escrow does not hold; it becomes `UnderReview`
            // on the next `fund` and can be resolved then.
            require!(
                matches!(tip.status, TipStatus::UnderReview),
                E14_INVALID_STATUS
            );
            (tip.programme_id, programme.max_reward.0)
        };

        if accept {
            // `None` means the full pre-committed reward: the funder locked `max_reward` per tip, so
            // "accept at the maximum" is the answer that needs no number.
            let reward = reward.unwrap_or(U128(max_reward)).0;
            require!(reward <= max_reward, E15_REWARD_TOO_HIGH);
            // Only the part of the reservation the tip will not claim is freed; the rest stays
            // committed until `claim` pays it and `on_claim_paid` releases it (S-3.5).
            self.release_reservation(programme_id, max_reward - reward);
            let tip = self.need_tip(tip_id);
            tip.status = TipStatus::Accepted {
                reward: U128(reward),
            };
            emit(SealedTipEvent::TipResolved {
                tip_id,
                accepted: true,
                reward: U128(reward),
            });
        } else {
            require!(reward.is_none(), E31_REWARD_ON_REJECT);
            self.release_reservation(programme_id, max_reward);
            let tip = self.need_tip(tip_id);
            tip.status = TipStatus::Rejected;
            emit(SealedTipEvent::TipResolved {
                tip_id,
                accepted: false,
                reward: U128(0),
            });
        }
    }

    /// Relayer, signed by the tipster; only before a decision.
    pub fn retract(&mut self, tip_id: TipId, nonce: u64, signature: Base64VecU8) {
        let _ = (tip_id, nonce, signature);
        todo!("S-3.4")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{
        as_caller, contract_with, contract_with_tip, funder, make_programme, make_tip, member_1,
        member_2, member_3, panel_dao, programme_balances, relayer_1, tip_with_status, token,
        CLAIM_PUBKEY, CLEANING_REPORT_HASH, EVIDENCE_HASH, HOUR_NS,
    };
    use near_sdk::json_types::Base64VecU8;

    const DAY_NS: u64 = 86_400_000_000_000;

    fn sig(bytes: Vec<u8>) -> Base64VecU8 {
        Base64VecU8::from(bytes)
    }

    /// Two honest sealed keys, the minimum the contract accepts.
    fn keys() -> Vec<SealedKey> {
        make_tip().sealed_keys
    }

    fn submit(
        contract: &mut Contract,
        sealed_keys: Vec<SealedKey>,
        recused: Vec<AccountId>,
        pow_nonce: u64,
        signature: Base64VecU8,
    ) -> TipId {
        contract.submit_tip(
            0,
            CLAIM_PUBKEY,
            "0a1b2c".to_string(),
            EVIDENCE_HASH,
            sealed_keys,
            recused,
            CLEANING_REPORT_HASH,
            None,
            None,
            pow_nonce,
            signature,
        )
    }

    /// A programme whose PoW is trivial, so the guards under test are the ones after it.
    fn open_pow_zero() -> Programme {
        let mut programme = make_programme();
        programme.pow_bits = 0;
        programme
    }

    #[test]
    #[should_panic(expected = "E04_NOT_RELAYER")]
    fn a_panel_member_cannot_submit_a_tip() {
        let mut contract = contract_with(vec![make_programme()], vec![]);
        as_caller(member_1());
        submit(&mut contract, keys(), vec![], 0, sig(vec![0u8; 64]));
    }

    #[test]
    #[should_panic(expected = "E01_PROGRAMME_NOT_FOUND")]
    fn submitting_to_a_programme_that_does_not_exist_is_refused() {
        let mut contract = contract_with(vec![make_programme()], vec![]);
        as_caller(relayer_1());
        contract.submit_tip(
            9,
            CLAIM_PUBKEY,
            "0a1b2c".to_string(),
            EVIDENCE_HASH,
            keys(),
            vec![],
            CLEANING_REPORT_HASH,
            None,
            None,
            0,
            sig(vec![0u8; 64]),
        );
    }

    #[test]
    #[should_panic(expected = "E17_PROGRAMME_CLOSED")]
    fn a_closed_programme_takes_no_new_tips() {
        let mut programme = make_programme();
        programme.open = false;
        let mut contract = contract_with(vec![programme], vec![]);
        as_caller(relayer_1());
        submit(&mut contract, keys(), vec![], 0, sig(vec![0u8; 64]));
    }

    #[test]
    #[should_panic(expected = "E11_POW_TOO_LOW")]
    fn a_nonce_below_the_required_bits_is_refused() {
        // Invariant 2: the contract checks PoW itself, on sha256(evidence_hash ‖ u64le(nonce)).
        let mut contract = contract_with_tip();
        as_caller(relayer_1());
        submit(&mut contract, keys(), vec![], 0, sig(vec![0u8; 64]));
    }

    #[test]
    #[should_panic(expected = "E12_TOO_FEW_SEALED_KEYS")]
    fn one_sealed_key_is_not_a_quorum() {
        let mut contract = contract_with(vec![open_pow_zero()], vec![]);
        as_caller(relayer_1());
        submit(
            &mut contract,
            vec![keys().remove(0)],
            vec![],
            0,
            sig(vec![0u8; 64]),
        );
    }

    #[test]
    #[should_panic(expected = "E12_TOO_FEW_SEALED_KEYS")]
    fn two_entries_for_one_member_are_still_one_member() {
        let one = keys().remove(0);
        let mut contract = contract_with(vec![open_pow_zero()], vec![]);
        as_caller(relayer_1());
        submit(
            &mut contract,
            vec![one.clone(), one],
            vec![],
            0,
            sig(vec![0u8; 64]),
        );
    }

    #[test]
    #[should_panic(expected = "E13_SEALED_TO_RECUSED")]
    fn a_key_sealed_to_a_recused_member_is_refused() {
        let mut keys = keys();
        keys.push(SealedKey {
            member: member_3(),
            cid: "sealed-3".to_string(),
        });
        let mut contract = contract_with(vec![open_pow_zero()], vec![]);
        as_caller(relayer_1());
        submit(&mut contract, keys, vec![member_3()], 0, sig(vec![0u8; 64]));
    }

    #[test]
    #[should_panic(expected = "E09_BAD_SIGNATURE")]
    fn the_signature_is_the_last_thing_a_rejected_submission_reaches() {
        // PoW trivial, keys honest, recusal clean — so the only rule left is the tipster's signature,
        // and a garbage one must not be able to create a tip.
        let mut contract = contract_with(vec![open_pow_zero()], vec![]);
        as_caller(relayer_1());
        submit(&mut contract, keys(), vec![], 0, sig(vec![7u8; 64]));
    }

    #[test]
    fn arming_the_switch_scales_the_interval_and_stays_disarmed() {
        let armed = arm_switch(
            SwitchInput {
                interval: U64(DAY_NS),
                grace: U64(4 * HOUR_NS),
                bundle_key_for_keeper: "k-switch".to_string(),
                includes_raw: false,
            },
            HOUR_NS,
            1440,
        );
        // Demo mode: a day per minute, so the first deadline is one minute out, not a day.
        assert_eq!(armed.next_deadline.0, HOUR_NS + 60_000_000_000);
        assert!(!armed.triggered);
        assert!(!armed.includes_raw);
        // Real time is the same call with no compression.
        let real = arm_switch(
            SwitchInput {
                interval: U64(DAY_NS),
                grace: U64(4 * HOUR_NS),
                bundle_key_for_keeper: "k-switch".to_string(),
                includes_raw: true,
            },
            HOUR_NS,
            1,
        );
        assert_eq!(real.next_deadline.0, HOUR_NS + DAY_NS);
        assert!(real.includes_raw);
    }

    // --- triage -----------------------------------------------------------------------------

    #[test]
    fn a_credible_triage_reserves_the_max_reward_and_asks_for_nothing_yet() {
        let mut contract = contract_with_tip();
        as_caller(member_1());
        contract.triage(0, true);
        assert_eq!(
            contract.programmes.get(&0).unwrap().reserved.0,
            500,
            "triage is the only place a reservation is created"
        );
        let tip = contract.tips.get(&0).unwrap();
        assert_eq!(tip.status, TipStatus::UnderReview);
        assert_eq!(tip.triaged_by, Some(member_1()));
    }

    #[test]
    fn the_reservation_appears_at_triage_and_not_before_it() {
        // Invariant 1, checked as a delta: the reservation appears with `triage`, not before it.
        let mut contract = contract_with_tip();
        assert_eq!(contract.programmes.get(&0).unwrap().reserved.0, 0);
        as_caller(member_2());
        contract.triage(0, true);
        assert_eq!(contract.programmes.get(&0).unwrap().reserved.0, 500);
    }

    #[test]
    fn a_credible_triage_on_a_short_programme_is_unfunded_not_refused() {
        let mut contract = contract_with(
            vec![programme_balances(100, 0)],
            vec![tip_with_status(0, 0, TipStatus::Submitted)],
        );
        as_caller(member_1());
        contract.triage(0, true);
        assert_eq!(contract.tips.get(&0).unwrap().status, TipStatus::Unfunded);
        assert_eq!(
            contract.programmes.get(&0).unwrap().reserved.0,
            0,
            "nothing was reserved, so the funder can still withdraw the 100"
        );
    }

    #[test]
    fn a_dismissal_reserves_nothing_and_costs_the_programme_nothing() {
        let mut contract = contract_with_tip();
        as_caller(member_1());
        contract.triage(0, false);
        let programme = contract.programmes.get(&0).unwrap();
        assert_eq!(programme.reserved.0, 0);
        assert_eq!(programme.balance.0, 1000);
        assert_eq!(contract.tips.get(&0).unwrap().status, TipStatus::Dismissed);
    }

    #[test]
    #[should_panic(expected = "E06_NOT_PANEL_MEMBER")]
    fn the_funder_cannot_triage() {
        let mut contract = contract_with_tip();
        as_caller(funder());
        contract.triage(0, true);
    }

    #[test]
    #[should_panic(expected = "E06_NOT_PANEL_MEMBER")]
    fn a_recused_member_cannot_triage() {
        let mut tip = make_tip();
        tip.recused = vec![member_1()];
        let mut contract = contract_with(vec![make_programme()], vec![tip]);
        as_caller(member_1());
        contract.triage(0, true);
    }

    #[test]
    #[should_panic(expected = "E14_INVALID_STATUS")]
    fn a_tip_is_triaged_once() {
        let mut contract = contract_with_tip();
        as_caller(member_1());
        contract.triage(0, true);
        as_caller(member_2());
        contract.triage(0, false);
    }

    #[test]
    #[should_panic(expected = "E02_TIP_NOT_FOUND")]
    fn triaging_a_tip_that_does_not_exist_is_refused() {
        let mut contract = contract_with(vec![make_programme()], vec![]);
        as_caller(member_1());
        contract.triage(4, true);
    }

    // --- resolve ------------------------------------------------------------------------------

    fn under_review() -> Contract {
        contract_with(
            vec![programme_balances(1000, 500)],
            vec![tip_with_status(0, 0, TipStatus::UnderReview)],
        )
    }

    #[test]
    fn accepting_at_the_default_pays_the_maximum_and_holds_the_reservation() {
        let mut contract = under_review();
        as_caller(panel_dao());
        contract.resolve_tip(0, true, None);
        assert_eq!(
            contract.tips.get(&0).unwrap().status,
            TipStatus::Accepted { reward: U128(500) }
        );
        // The whole reservation stays: `claim` releases what it actually paid (S-3.5).
        assert_eq!(contract.programmes.get(&0).unwrap().reserved.0, 500);
    }

    #[test]
    fn accepting_below_the_maximum_releases_only_the_unused_part() {
        let mut contract = under_review();
        as_caller(panel_dao());
        contract.resolve_tip(0, true, Some(U128(200)));
        assert_eq!(
            contract.programmes.get(&0).unwrap().reserved.0,
            200,
            "300 of the reservation is no longer backing anything"
        );
        assert_eq!(
            contract.tips.get(&0).unwrap().status,
            TipStatus::Accepted { reward: U128(200) }
        );
    }

    #[test]
    fn rejecting_returns_everything_the_tip_was_backing() {
        let mut contract = under_review();
        as_caller(panel_dao());
        contract.resolve_tip(0, false, None);
        assert_eq!(contract.programmes.get(&0).unwrap().reserved.0, 0);
        assert_eq!(contract.tips.get(&0).unwrap().status, TipStatus::Rejected);
    }

    #[test]
    #[should_panic(expected = "E15_REWARD_TOO_HIGH")]
    fn a_reward_above_the_locked_maximum_is_refused() {
        let mut contract = under_review();
        as_caller(panel_dao());
        contract.resolve_tip(0, true, Some(U128(501)));
    }

    #[test]
    #[should_panic(expected = "E31_REWARD_ON_REJECT")]
    fn rejection_with_a_reward_attached_is_not_read_as_zero() {
        let mut contract = under_review();
        as_caller(panel_dao());
        contract.resolve_tip(0, false, Some(U128(0)));
    }

    #[test]
    #[should_panic(expected = "E05_NOT_PANEL_DAO")]
    fn a_panel_member_cannot_resolve() {
        let mut contract = under_review();
        as_caller(member_1());
        contract.resolve_tip(0, true, None);
    }

    #[test]
    #[should_panic(expected = "E14_INVALID_STATUS")]
    fn an_unfunded_tip_cannot_be_resolved_before_money_arrives() {
        let mut contract = contract_with(
            vec![programme_balances(1000, 0)],
            vec![tip_with_status(0, 0, TipStatus::Unfunded)],
        );
        as_caller(panel_dao());
        contract.resolve_tip(0, true, None);
    }

    #[test]
    #[should_panic(expected = "E14_INVALID_STATUS")]
    fn a_submitted_tip_cannot_skip_triage() {
        let mut contract = contract_with_tip();
        as_caller(panel_dao());
        contract.resolve_tip(0, true, None);
    }

    #[test]
    fn funding_an_unfunded_tip_promotes_it_and_says_so() {
        // S-3.9 through the door `triage` left open: the judgement is kept, the money catches up.
        let mut contract = contract_with(
            vec![programme_balances(0, 0)],
            vec![tip_with_status(0, 0, TipStatus::Unfunded)],
        );
        as_caller(token());
        contract.fund(U128(1000), "{\"fund\": 0}".to_string());
        assert_eq!(
            contract.tips.get(&0).unwrap().status,
            TipStatus::UnderReview
        );
        assert_eq!(contract.programmes.get(&0).unwrap().reserved.0, 500);
        let logs = near_sdk::test_utils::get_logs();
        assert!(
            logs.iter().any(|l| l.contains("tip_triaged")),
            "a status change with no event is invisible to the panel: {logs:?}"
        );
    }
}
