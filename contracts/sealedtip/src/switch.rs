//! Dead man's switch. (S-3.6–S-3.8)

use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{env, near, require};

use crate::access;
use crate::errors::{
    E13_SEALED_TO_RECUSED, E14_INVALID_STATUS, E18_SWITCH_NOT_DUE, E19_NO_SWITCH, E20_NOT_TRIGGERED,
};
use crate::events::{emit, SealedTipEvent};
use crate::time;
use crate::types::{Action, SealedKey, TipId};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Relayer, signed by the tipster: the deadline moves to `now + interval`.
    pub fn checkin(&mut self, tip_id: TipId, nonce: u64, signature: Base64VecU8) {
        access::assert_relayer(self);
        // The two refusals that cost nothing come before the signature, because they are the two a
        // caller can trip without holding any key: a tip with no switch has no deadline to extend
        // (E19), and a switch that has already fired is not re-armed by a check-in (E14) — by then the
        // keeper may have released the bundle key, so "I'm back" is not something this contract can
        // honour any more.
        let (interval, time_scale) = {
            let (programme, tip) = self.programme_and_tip(tip_id);
            let switch = tip
                .switch
                .as_ref()
                .unwrap_or_else(|| env::panic_str(E19_NO_SWITCH));
            require!(!switch.triggered, E14_INVALID_STATUS);
            (switch.interval.0, programme.time_scale)
        };
        self.assert_signed(tip_id, nonce, Action::Checkin, &signature);
        let now_ns = env::block_timestamp();
        let tip = self.need_tip(tip_id);
        tip.nonce = nonce;
        // Checked above, and no statement between the two can take a tip's switch away, so this is the
        // same guard rather than a new one: it fails loudly instead of skipping the deadline.
        let switch = tip
            .switch
            .as_mut()
            .unwrap_or_else(|| env::panic_str(E19_NO_SWITCH));
        // From *now*, not from the old deadline: what the switch measures is how long the tipster has
        // been silent, so a check-in restarts that clock instead of adding to it.
        switch.next_deadline = U64(time::deadline(now_ns, interval, time_scale));
        emit(SealedTipEvent::Checkin { tip_id });
    }

    /// Anyone, once `next_deadline + grace` has passed (E18).
    pub fn trigger(&mut self, tip_id: TipId) {
        // Deliberately no role guard. The switch is the tipster's protection against everyone, so the
        // party allowed to run it cannot be an allow-list they might all be in; what makes an open
        // entry point safe here is that it can only be reached after the tipster's own deadline and
        // grace have passed, and all it can do is record that they have.
        let now_ns = env::block_timestamp();
        let (programme, tip) = self.programme_and_tip(tip_id);
        let switch = tip
            .switch
            .as_mut()
            .unwrap_or_else(|| env::panic_str(E19_NO_SWITCH));
        require!(!switch.triggered, E14_INVALID_STATUS);
        // The grace is scaled the way the interval was, so demo mode keeps the ratio the tipster
        // chose instead of pairing a compressed deadline with an uncompressed grace.
        let due = time::deadline(switch.next_deadline.0, switch.grace.0, programme.time_scale);
        require!(now_ns >= due, E18_SWITCH_NOT_DUE);
        switch.triggered = true;
        emit(SealedTipEvent::SwitchTriggered { tip_id });
    }

    /// Keeper only, after a trigger, and never naming a recused member.
    pub fn post_released_keys(&mut self, tip_id: TipId, keys: Vec<SealedKey>) {
        access::assert_keeper(self);
        let tip = self.need_tip(tip_id);
        let triggered = tip.switch.as_ref().is_some_and(|switch| switch.triggered);
        // E20, not E18: the deadline rule belongs to `trigger`. This one says the keeper is answering
        // a release the tipster has not asked for yet.
        require!(triggered, E20_NOT_TRIGGERED);
        // The privacy boundary is enforced here rather than taken on trust. `get_tip_for_panel` hands
        // these CIDs to whoever asks as a panel member, so a released key naming a recused reviewer
        // would put the switch bundle key in front of exactly the person the tipster excluded — and a
        // compromised keeper must not be able to do that on the contract's word.
        for key in &keys {
            require!(!tip.recused.contains(&key.member), E13_SEALED_TO_RECUSED);
        }
        // Replaces rather than appends, so a keeper that posted a wrong set can correct it. What the
        // contract can check is whose name each entry carries; that the ciphertext under it really is
        // K_switch re-sealed to that member's key is the keeper's job, because the keeper is the only
        // party that ever held K_switch.
        tip.released_keys = keys;
        emit(SealedTipEvent::KeysReleased { tip_id });
    }

    /// Keeper only. The liveness number `get_programme_stats` publishes.
    pub fn heartbeat(&mut self) {
        access::assert_keeper(self);
        // Zeroed by `set_keeper` (S-2.9), so a new keeper has to prove it is running rather than
        // inherit the previous one's last word.
        self.keeper_last_seen = env::block_timestamp();
        emit(SealedTipEvent::KeeperHeartbeat {});
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{
        as_caller, as_caller_at, contract_with, contract_with_armed_tip, contract_with_tip, funder,
        keeper, make_programme, make_tip, member_1, member_2, member_3, owner, panel_dao,
        programme_balances, relayer_1, sign_action, tip_with_nonce, tip_with_switch, HOUR_NS,
    };
    use near_sdk::json_types::Base64VecU8;
    use near_sdk::AccountId;

    const DAY_NS: u64 = 24 * HOUR_NS;

    /// `armed()` is due 25 h after submission with four hours of grace on top, so a block at 30 h of
    /// programme time is past both.
    const AFTER_GRACE: u64 = 30 * HOUR_NS;

    /// A tipster's `Checkin` at `nonce` for tip 0, as the relayer would forward it.
    fn checkin(nonce: u64) -> Base64VecU8 {
        sign_action(0, nonce, Action::Checkin)
    }

    fn retract(nonce: u64) -> Base64VecU8 {
        sign_action(0, nonce, Action::Retract)
    }

    /// The tip 1000 tUSDC programme and an armed tip whose switch is due at `HOUR_NS + DAY_NS`, with
    /// four hours of grace on top.
    fn armed() -> Contract {
        contract_with_armed_tip()
    }

    fn deadline(contract: &Contract) -> u64 {
        contract
            .tips
            .get(&0)
            .unwrap()
            .switch
            .clone()
            .unwrap()
            .next_deadline
            .0
    }

    // --- checkin (S-3.6) --------------------------------------------------------------------

    #[test]
    fn a_signed_checkin_moves_the_deadline_out_by_one_interval() {
        let mut contract = armed();
        as_caller_at(
            relayer_1(),
            2 * HOUR_NS,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.checkin(0, 1, checkin(1));
        assert_eq!(
            deadline(&contract),
            2 * HOUR_NS + DAY_NS,
            "the clock restarts from the check-in, it does not add to what was left"
        );
        assert_eq!(contract.tips.get(&0).unwrap().nonce, 1);
    }

    #[test]
    fn checkin_scales_the_interval_the_way_it_scales_everything_else() {
        let mut programme = make_programme();
        programme.time_scale = 1440;
        let mut contract = contract_with(
            vec![programme],
            vec![tip_with_switch(make_tip(), DAY_NS, 4 * HOUR_NS)],
        );
        as_caller_at(
            relayer_1(),
            2 * HOUR_NS,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.checkin(0, 1, checkin(1));
        // Demo mode: a day per minute, so the new deadline is two minutes out, not a day.
        assert_eq!(deadline(&contract), 2 * HOUR_NS + 60_000_000_000);
    }

    #[test]
    #[should_panic(expected = "E04_NOT_RELAYER")]
    fn a_panel_member_cannot_check_in_for_the_tipster() {
        let mut contract = armed();
        as_caller(member_1());
        contract.checkin(0, 1, checkin(1));
    }

    #[test]
    #[should_panic(expected = "E19_NO_SWITCH")]
    fn a_tip_with_no_switch_has_no_deadline_to_extend() {
        // The tipster turned the switch off at submission, so `checkin` is not a no-op with a
        // different meaning — it is a call about something that does not exist.
        let mut contract = contract_with_tip();
        as_caller(relayer_1());
        contract.checkin(0, 1, checkin(1));
    }

    #[test]
    #[should_panic(expected = "E09_BAD_SIGNATURE")]
    fn a_checkin_signed_with_the_wrong_key_is_refused() {
        let mut contract = armed();
        as_caller(relayer_1());
        contract.checkin(0, 1, Base64VecU8(vec![0u8; 64]));
    }

    #[test]
    #[should_panic(expected = "E10_BAD_NONCE")]
    fn a_checkin_replay_does_not_extend_the_deadline_twice() {
        let mut contract = armed();
        let signature = checkin(1);
        as_caller_at(
            relayer_1(),
            2 * HOUR_NS,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.checkin(0, 1, signature.clone());
        assert_eq!(deadline(&contract), 2 * HOUR_NS + DAY_NS);
        // The relayer forwards the same bytes again. The nonce says it has already been spent, so
        // the deadline cannot move a second time on a signature the tipster only gave once.
        contract.checkin(0, 1, signature);
    }

    #[test]
    #[should_panic(expected = "E14_INVALID_STATUS")]
    fn a_checkin_cannot_un_trigger_a_switch_that_has_already_fired() {
        let mut contract = armed();
        as_caller_at(funder(), 2 * DAY_NS, near_sdk::NearToken::from_yoctonear(0));
        contract.trigger(0);
        as_caller_at(
            relayer_1(),
            3 * DAY_NS,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.checkin(0, 1, checkin(1));
    }

    // --- trigger (S-3.7) --------------------------------------------------------------------

    #[test]
    fn the_deadline_plus_grace_opens_the_switch_to_anyone() {
        // Due at 25 h + 4 h of grace; this block is one hour later, and the caller is nobody in
        // particular. The rule is that the release does not need anyone's permission, only the
        // tipster's silence.
        let mut contract = armed();
        as_caller_at(
            "anyone.testnet".parse().unwrap(),
            AFTER_GRACE,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.trigger(0);
        assert!(
            contract
                .tips
                .get(&0)
                .unwrap()
                .switch
                .as_ref()
                .unwrap()
                .triggered
        );
    }

    #[test]
    #[should_panic(expected = "E18_SWITCH_NOT_DUE")]
    fn a_trigger_before_the_deadline_is_refused() {
        let mut contract = armed();
        as_caller_at(member_1(), DAY_NS, near_sdk::NearToken::from_yoctonear(0));
        contract.trigger(0);
    }

    #[test]
    #[should_panic(expected = "E18_SWITCH_NOT_DUE")]
    fn the_grace_is_given_as_well_as_the_deadline() {
        // One hour past the deadline but inside the four-hour grace: a tipster who checks in late has
        // that window, and a trigger inside it would release the bundle against their wishes.
        let mut contract = armed();
        as_caller_at(
            member_1(),
            25 * HOUR_NS + HOUR_NS,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.trigger(0);
    }

    #[test]
    #[should_panic(expected = "E14_INVALID_STATUS")]
    fn a_switch_triggers_once() {
        // A second trigger would emit `switch_triggered` again, and a watcher counting those events
        // would count the same release twice.
        let mut contract = armed();
        as_caller_at(
            funder(),
            AFTER_GRACE,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.trigger(0);
        contract.trigger(0);
    }

    #[test]
    #[should_panic(expected = "E19_NO_SWITCH")]
    fn a_tip_with_no_switch_cannot_be_triggered() {
        let mut contract = contract_with_tip();
        as_caller_at(
            funder(),
            100 * DAY_NS,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.trigger(0);
    }

    #[test]
    #[should_panic(expected = "E18_SWITCH_NOT_DUE")]
    fn demo_mode_still_protects_inside_the_compressed_grace() {
        // Scale 1440: the day interval is a minute of blocks and the four-hour grace is ten seconds,
        // so due is 70 s after submission. A block at 63 s is past the deadline but inside the grace —
        // the compression must shorten the grace, not delete it.
        let mut contract = demo_armed();
        as_caller_at(
            funder(),
            HOUR_NS + 63_000_000_000,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.trigger(0);
    }

    #[test]
    fn demo_mode_releases_once_the_compressed_grace_has_passed() {
        let mut contract = demo_armed();
        as_caller_at(
            funder(),
            HOUR_NS + 71_000_000_000,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.trigger(0);
        assert!(
            contract
                .tips
                .get(&0)
                .unwrap()
                .switch
                .as_ref()
                .unwrap()
                .triggered
        );
    }

    /// Armed the way `submit_tip` arms on a scale-1440 programme: one day of tipster time is one
    /// minute of blocks, so the deadline sits 60 s after submission while the stored interval still
    /// reads a day and the grace still reads four hours.
    fn demo_armed() -> Contract {
        let mut programme = make_programme();
        programme.time_scale = 1440;
        let mut tip = tip_with_switch(make_tip(), DAY_NS, 4 * HOUR_NS);
        tip.switch.as_mut().unwrap().next_deadline = U64(HOUR_NS + 60_000_000_000);
        contract_with(vec![programme], vec![tip])
    }

    // --- post_released_keys (S-3.8) ---------------------------------------------------------

    fn released(member: AccountId, cid: &str) -> SealedKey {
        SealedKey {
            member,
            cid: cid.to_string(),
        }
    }

    /// A tip whose switch has fired, so the keeper may answer it.
    fn triggered() -> Contract {
        let mut contract = armed();
        as_caller_at(
            funder(),
            AFTER_GRACE,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.trigger(0);
        contract
    }

    #[test]
    fn the_keeper_posts_the_released_keys() {
        let mut contract = triggered();
        as_caller(keeper());
        contract.post_released_keys(
            0,
            vec![released(member_1(), "k-1"), released(member_2(), "k-2")],
        );
        let tip = contract.tips.get(&0).unwrap();
        assert_eq!(tip.released_keys.len(), 2);
        assert_eq!(tip.released_keys[0].cid, "k-1");
    }

    #[test]
    fn a_second_post_replaces_the_first_so_a_mistake_can_be_corrected() {
        let mut contract = triggered();
        as_caller(keeper());
        contract.post_released_keys(0, vec![released(member_1(), "wrong")]);
        contract.post_released_keys(0, vec![released(member_2(), "right")]);
        let tip = contract.tips.get(&0).unwrap();
        assert_eq!(tip.released_keys, vec![released(member_2(), "right")]);
    }

    #[test]
    #[should_panic(expected = "E07_NOT_KEEPER")]
    fn only_the_keeper_can_post_released_keys() {
        let mut contract = triggered();
        as_caller(owner());
        contract.post_released_keys(0, vec![released(member_1(), "k-1")]);
    }

    #[test]
    #[should_panic(expected = "E07_NOT_KEEPER")]
    fn a_panel_member_cannot_post_their_own_release() {
        let mut contract = triggered();
        as_caller(member_1());
        contract.post_released_keys(0, vec![released(member_1(), "k-1")]);
    }

    #[test]
    #[should_panic(expected = "E20_NOT_TRIGGERED")]
    fn the_keeper_cannot_release_before_the_tipster_has_been_silent_long_enough() {
        let mut contract = armed();
        as_caller(keeper());
        contract.post_released_keys(0, vec![released(member_1(), "k-1")]);
    }

    #[test]
    #[should_panic(expected = "E13_SEALED_TO_RECUSED")]
    fn a_released_key_naming_a_recused_member_is_refused() {
        // This is the keeper's own compromise case: the recusal must not be something the contract
        // hopes the keeper remembered.
        let mut tip = tip_with_switch(make_tip(), DAY_NS, 4 * HOUR_NS);
        tip.recused = vec![member_3()];
        let mut contract = contract_with(vec![make_programme()], vec![tip]);
        as_caller_at(
            funder(),
            AFTER_GRACE,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.trigger(0);
        as_caller(keeper());
        contract.post_released_keys(
            0,
            vec![released(member_1(), "k-1"), released(member_3(), "k-3")],
        );
    }

    #[test]
    fn recusal_only_blocks_the_recused_name_not_the_whole_release() {
        let mut tip = tip_with_switch(make_tip(), DAY_NS, 4 * HOUR_NS);
        tip.recused = vec![member_3()];
        let mut contract = contract_with(vec![make_programme()], vec![tip]);
        as_caller_at(
            funder(),
            AFTER_GRACE,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.trigger(0);
        as_caller(keeper());
        contract.post_released_keys(
            0,
            vec![released(member_1(), "k-1"), released(member_2(), "k-2")],
        );
        assert_eq!(contract.tips.get(&0).unwrap().released_keys.len(), 2);
    }

    #[test]
    #[should_panic(expected = "E02_TIP_NOT_FOUND")]
    fn posting_keys_for_a_tip_that_does_not_exist_is_refused() {
        let mut contract = triggered();
        as_caller(keeper());
        contract.post_released_keys(7, vec![released(member_1(), "k-1")]);
    }

    // --- heartbeat (S-3.8) ------------------------------------------------------------------

    #[test]
    fn a_heartbeat_records_the_block_it_was_seen_in() {
        let mut contract = contract_with_tip();
        as_caller_at(
            keeper(),
            5 * HOUR_NS,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.heartbeat();
        assert_eq!(contract.keeper_last_seen, 5 * HOUR_NS);
    }

    #[test]
    #[should_panic(expected = "E07_NOT_KEEPER")]
    fn nobody_else_can_write_the_liveness_number() {
        // The funder, the owner and the panel all have a reason to want this to look recent; none of
        // them gets to say so.
        let mut contract = contract_with_tip();
        as_caller(funder());
        contract.heartbeat();
    }

    #[test]
    #[should_panic(expected = "E07_NOT_KEEPER")]
    fn the_owner_who_appointed_the_keeper_cannot_heartbeat() {
        let mut contract = contract_with_tip();
        as_caller(owner());
        contract.heartbeat();
    }

    #[test]
    fn set_keeper_zeroes_the_liveness_it_inherited() {
        // Documented in S-2.9 and checked here because `heartbeat` is the other half of it: the new
        // keeper has not proven anything yet.
        let mut contract = contract_with_tip();
        as_caller_at(
            keeper(),
            5 * HOUR_NS,
            near_sdk::NearToken::from_yoctonear(0),
        );
        contract.heartbeat();
        as_caller(owner());
        let next: AccountId = "keeper-2.testnet".parse().unwrap();
        contract.set_keeper(next, [9; 32]);
        assert_eq!(contract.keeper_last_seen, 0);
    }

    // --- retract (S-3.4), next to the switch it interacts with -------------------------------

    #[test]
    fn a_tipster_can_withdraw_a_tip_nobody_has_judged_yet() {
        let mut contract = contract_with_tip();
        as_caller(relayer_1());
        contract.retract(0, 1, retract(1));
        assert_eq!(
            contract.tips.get(&0).unwrap().status,
            crate::types::TipStatus::Retracted
        );
        assert_eq!(contract.tips.get(&0).unwrap().nonce, 1);
    }

    #[test]
    fn retracting_a_tip_under_review_gives_the_reservation_back_to_the_funder() {
        // Invariant 1's other half: `triage` reserved `max_reward` and nobody voted, so all of it is
        // unused and a tipster walking away must not strand it.
        let mut contract = contract_with_tip();
        as_caller(member_1());
        contract.triage(0, true);
        assert_eq!(contract.programmes.get(&0).unwrap().reserved.0, 500);
        as_caller(relayer_1());
        contract.retract(0, 1, retract(1));
        let programme = contract.programmes.get(&0).unwrap();
        assert_eq!(programme.reserved.0, 0);
        assert_eq!(programme.balance.0, 1000);
    }

    #[test]
    fn retracting_an_unfunded_tip_reserves_and_releases_nothing() {
        // `triage` found the programme short and reserved nothing, so the retraction that returns a
        // reservation has nothing to return — and it must not underflow trying.
        let mut contract = contract_with(vec![programme_balances(100, 0)], vec![tip_with_nonce(0)]);
        as_caller(member_1());
        contract.triage(0, true);
        as_caller(relayer_1());
        contract.retract(0, 1, retract(1));
        assert_eq!(contract.programmes.get(&0).unwrap().reserved.0, 0);
    }

    #[test]
    #[should_panic(expected = "E14_INVALID_STATUS")]
    fn a_tipster_cannot_retract_after_the_panel_has_decided() {
        let mut contract = contract_with_tip();
        as_caller(member_1());
        contract.triage(0, true);
        as_caller(panel_dao());
        contract.resolve_tip(0, true, None);
        as_caller(relayer_1());
        contract.retract(0, 1, retract(1));
    }

    #[test]
    #[should_panic(expected = "E14_INVALID_STATUS")]
    fn a_tip_cannot_be_retracted_twice() {
        let mut contract = contract_with_tip();
        as_caller(relayer_1());
        contract.retract(0, 1, retract(1));
        contract.retract(0, 2, retract(2));
    }

    #[test]
    #[should_panic(expected = "E09_BAD_SIGNATURE")]
    fn a_retract_signed_with_the_wrong_key_is_refused() {
        let mut contract = contract_with_tip();
        as_caller(relayer_1());
        contract.retract(0, 1, Base64VecU8(vec![0u8; 64]));
    }

    #[test]
    #[should_panic(expected = "E04_NOT_RELAYER")]
    fn a_tipster_cannot_retract_without_a_relayer() {
        // The tipster has no account, so "signed by the tipster" has always meant "forwarded by a
        // relayer" — and a relayer cannot invent the signature.
        let mut contract = contract_with_tip();
        as_caller("anyone.testnet".parse().unwrap());
        contract.retract(0, 1, retract(1));
    }

    #[test]
    #[should_panic(expected = "E14_INVALID_STATUS")]
    fn a_dismissed_tip_cannot_be_retracted_and_owed_nothing_anyway() {
        // The money half is checked first: a dismissal reserved nothing, so there was never a
        // reservation to hand back. The status half is what the panic is for — the panel has already
        // answered, and `Retracted` would overwrite their "no" with the tipster's walk-away.
        let mut contract = contract_with_tip();
        as_caller(member_1());
        contract.triage(0, false);
        let programme = contract.programmes.get(&0).unwrap();
        assert_eq!(programme.reserved.0, 0);
        assert_eq!(
            programme.balance.0, 1000,
            "a dismissal never spent anything"
        );
        as_caller(relayer_1());
        contract.retract(0, 1, retract(1));
    }
}
