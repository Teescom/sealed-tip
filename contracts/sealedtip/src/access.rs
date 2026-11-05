//! Role guards: one helper per role, all reading the predecessor (AGENTS "access control first").
//! (S-2.7)

use near_sdk::env;
use near_sdk::require;

use crate::errors::{
    E03_NOT_FUNDER, E04_NOT_RELAYER, E05_NOT_PANEL_DAO, E06_NOT_PANEL_MEMBER, E07_NOT_KEEPER,
    E08_NOT_OWNER,
};
use crate::types::{Programme, Tip};
use crate::Contract;

pub fn assert_funder(p: &Programme) {
    require!(env::predecessor_account_id() == p.funder, E03_NOT_FUNDER);
}

pub fn assert_panel_dao(p: &Programme) {
    require!(
        env::predecessor_account_id() == p.panel_dao,
        E05_NOT_PANEL_DAO
    );
}

/// Caller ∈ programme.panel and ∉ tip.recused.
pub fn assert_panel_member(p: &Programme, t: &Tip) {
    let caller = env::predecessor_account_id();
    require!(
        p.panel.iter().any(|member| member.account == caller),
        E06_NOT_PANEL_MEMBER
    );
    require!(!t.recused.contains(&caller), E06_NOT_PANEL_MEMBER);
}

pub fn assert_relayer(c: &Contract) {
    require!(
        c.relayers.contains(&env::predecessor_account_id()),
        E04_NOT_RELAYER
    );
}

pub fn assert_keeper(c: &Contract) {
    require!(env::predecessor_account_id() == c.keeper, E07_NOT_KEEPER);
}

pub fn assert_owner(c: &Contract) {
    require!(env::predecessor_account_id() == c.owner, E08_NOT_OWNER);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{
        as_caller, funder, keeper, make_contract, make_programme, make_tip, member_1, member_2,
        member_3, owner, panel_dao, relayer_1, relayer_2,
    };

    fn outsider() -> near_sdk::AccountId {
        "someone-else.testnet".parse().unwrap()
    }

    #[test]
    fn funder_guard_accepts_the_programme_funder() {
        as_caller(funder());
        assert_funder(&make_programme());
    }

    #[test]
    #[should_panic(expected = "E03_NOT_FUNDER")]
    fn funder_guard_rejects_a_panel_member() {
        as_caller(member_1());
        assert_funder(&make_programme());
    }

    #[test]
    fn panel_dao_guard_accepts_the_dao() {
        as_caller(panel_dao());
        assert_panel_dao(&make_programme());
    }

    #[test]
    #[should_panic(expected = "E05_NOT_PANEL_DAO")]
    fn panel_dao_guard_rejects_the_funder_who_pays() {
        as_caller(funder());
        assert_panel_dao(&make_programme());
    }

    #[test]
    fn member_guard_accepts_any_panel_member() {
        as_caller(member_2());
        assert_panel_member(&make_programme(), &make_tip());
    }

    #[test]
    #[should_panic(expected = "E06_NOT_PANEL_MEMBER")]
    fn member_guard_rejects_an_account_outside_the_panel() {
        as_caller(outsider());
        assert_panel_member(&make_programme(), &make_tip());
    }

    #[test]
    #[should_panic(expected = "E06_NOT_PANEL_MEMBER")]
    fn member_guard_rejects_a_recused_member() {
        let mut recused = make_tip();
        recused.recused.push(member_3());
        as_caller(member_3());
        assert_panel_member(&make_programme(), &recused);
    }

    #[test]
    fn relayer_guard_accepts_both_allow_listed_relayers() {
        let contract = make_contract();
        as_caller(relayer_1());
        assert_relayer(&contract);
        as_caller(relayer_2());
        assert_relayer(&contract);
    }

    #[test]
    #[should_panic(expected = "E04_NOT_RELAYER")]
    fn relayer_guard_rejects_a_panel_member() {
        as_caller(member_1());
        assert_relayer(&make_contract());
    }

    #[test]
    fn keeper_guard_accepts_the_keeper() {
        as_caller(keeper());
        assert_keeper(&make_contract());
    }

    #[test]
    #[should_panic(expected = "E07_NOT_KEEPER")]
    fn keeper_guard_rejects_the_owner_who_appointed_them() {
        as_caller(owner());
        assert_keeper(&make_contract());
    }

    #[test]
    fn owner_guard_accepts_the_owner() {
        as_caller(owner());
        assert_owner(&make_contract());
    }

    #[test]
    #[should_panic(expected = "E08_NOT_OWNER")]
    fn owner_guard_rejects_a_relayer() {
        as_caller(relayer_1());
        assert_owner(&make_contract());
    }

    #[test]
    fn recusal_only_bars_triage_not_the_whole_panel() {
        // The invariant says recusal must not lock the programme out of its own review.
        let mut tip = make_tip();
        tip.recused.push(member_3());
        as_caller(member_1());
        assert_panel_member(&make_programme(), &tip);
    }
}
