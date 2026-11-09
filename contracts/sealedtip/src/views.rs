//! Views. Public tip view exposes no CIDs or keys. (S-2.11)
//!
//! These are the only reads the tipster UI is allowed to make without a wallet, so they set the
//! privacy boundary: `get_tip_public` must never carry anything that could narrow down who submitted
//! a tip (AGENTS privacy invariants), while `get_tip_for_panel` — which does carry CID pointers — is
//! reachable only by a panel member through their own session (S-6.4), not by an anonymous page.

use near_sdk::env;
use near_sdk::json_types::U64;
use near_sdk::near;

use crate::errors::E01_PROGRAMME_NOT_FOUND;
use crate::types::{
    KeeperInfo, Programme, ProgrammeId, ProgrammeStats, Tip, TipId, TipPublic, TipStatus,
};
use crate::{Contract, ContractExt};

/// `from_index` is a position in insertion order, not an id: `IterableMap` keeps entries in the
/// order they were created and nothing here ever removes one, so a page is stable across calls.
const DEFAULT_PAGE: u64 = 50;
/// Bounded so one RPC call cannot ask the node to serialize every programme since genesis.
const MAX_PAGE: u64 = 200;

fn page(from_index: Option<u64>, limit: Option<u64>) -> (usize, usize) {
    (
        from_index.unwrap_or(0) as usize,
        (limit.unwrap_or(DEFAULT_PAGE)).min(MAX_PAGE) as usize,
    )
}

#[near]
impl Contract {
    pub fn get_programme(&self, programme_id: ProgrammeId) -> Option<Programme> {
        self.programmes.get(&programme_id).cloned()
    }

    pub fn list_programmes(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Programme> {
        let (from, size) = page(from_index, limit);
        self.programmes
            .iter()
            .skip(from)
            .take(size)
            .map(|(_, programme)| programme.clone())
            .collect()
    }

    /// Walks every tip to count outcomes, so it is O(all tips) rather than O(this programme's tips).
    /// Accepted at demo scale; the fix if a programme ever outgrows it is a per-programme counter
    /// written on each status change, which would have to be audited against `tips` before use.
    pub fn get_programme_stats(&self, programme_id: ProgrammeId) -> ProgrammeStats {
        let programme = self
            .programmes
            .get(&programme_id)
            .unwrap_or_else(|| env::panic_str(E01_PROGRAMME_NOT_FOUND));
        let mut stats = ProgrammeStats {
            programme_id,
            balance: programme.balance,
            reserved: programme.reserved,
            submitted: 0,
            under_review: 0,
            accepted: 0,
            rejected: 0,
            paid: 0,
            keeper_last_seen: U64(self.keeper_last_seen),
        };
        for (_, tip) in self.tips.iter() {
            if tip.programme_id != programme_id {
                continue;
            }
            match tip.status {
                TipStatus::Submitted => stats.submitted += 1,
                // `Unfunded` is a credible tip still waiting on the panel, so it belongs in the
                // review queue count rather than in a fifth bucket the interface has no name for.
                TipStatus::UnderReview | TipStatus::Unfunded => stats.under_review += 1,
                TipStatus::Accepted { .. } => stats.accepted += 1,
                // `Dismissed` at triage and `Rejected` by the DAO are the same outcome to a funder.
                TipStatus::Rejected | TipStatus::Dismissed => stats.rejected += 1,
                TipStatus::Paid => stats.paid += 1,
                // `Retracted` is the tipster's own doing and spends nothing: ProgrammeStats (§5) has
                // no field for it, so it is counted nowhere rather than folded into a wrong bucket.
                TipStatus::Retracted => {}
            }
        }
        stats
    }

    pub fn get_tip_public(&self, tip_id: TipId) -> Option<TipPublic> {
        let tip = self.tips.get(&tip_id)?;
        Some(TipPublic {
            id: tip.id,
            programme_id: tip.programme_id,
            status: tip.status.clone(),
            submitted_at: tip.submitted_at,
            switch_deadline: tip.switch.as_ref().map(|switch| switch.next_deadline),
            switch_triggered: tip.switch.as_ref().is_some_and(|switch| switch.triggered),
        })
    }

    /// CIDs and sealed-key pointers (ciphertext anyway). For the panel UI.
    pub fn get_tip_for_panel(&self, tip_id: TipId) -> Option<Tip> {
        self.tips.get(&tip_id).cloned()
    }

    /// The keeper's identity, its X25519 public key, and the last time it proved it was alive.
    ///
    /// Read-only, and it adds no new fact to the world — every field is either an account id, a public
    /// half, or the number `get_programme_stats` already returns. What it adds is the *source*: the
    /// tipster's browser needs `keeper_x25519_pub` before it can arm a switch, and the chain is the only
    /// place that knows whose key it is after a `set_keeper`.
    pub fn get_keeper_info(&self) -> KeeperInfo {
        KeeperInfo {
            keeper: self.keeper.clone(),
            keeper_x25519_pub: self.keeper_x25519_pub,
            keeper_last_seen: U64(self.keeper_last_seen),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{
        acct, as_caller, contract_with, keeper, make_programme, make_tip, owner,
        programme_balances, tip_with_status, EVIDENCE_HASH, HOUR_NS, KEEPER_X25519,
    };
    use near_sdk::json_types::U128;

    /// Four programmes, ids 0..3, so a page boundary is visible.
    fn four_programmes() -> Contract {
        let programmes = (0..4)
            .map(|id| {
                let mut programme = make_programme();
                programme.id = id;
                programme.title = format!("programme {id}");
                programme
            })
            .collect();
        contract_with(programmes, vec![])
    }

    fn tips(statuses: impl IntoIterator<Item = TipStatus>) -> Vec<Tip> {
        statuses
            .into_iter()
            .enumerate()
            .map(|(id, status)| tip_with_status(id as u64, 0, status))
            .collect()
    }

    #[test]
    fn a_known_programme_reads_back_and_an_unknown_one_is_none() {
        let contract = four_programmes();
        assert_eq!(contract.get_programme(2).map(|p| p.id), Some(2));
        assert_eq!(contract.get_programme(9), None);
    }

    #[test]
    fn pages_are_bounded_and_step_through_without_repeats() {
        let contract = four_programmes();
        assert_eq!(
            contract
                .list_programmes(None, None)
                .iter()
                .map(|p| p.id)
                .collect::<Vec<_>>(),
            vec![0, 1, 2, 3]
        );
        let first = contract.list_programmes(Some(0), Some(2));
        let second = contract.list_programmes(Some(2), Some(2));
        assert_eq!(first.len(), 2);
        assert_eq!(second.len(), 2);
        assert_eq!(
            first
                .iter()
                .map(|p| p.id)
                .chain(second.iter().map(|p| p.id))
                .collect::<Vec<_>>(),
            vec![0, 1, 2, 3],
            "paging must neither repeat nor skip a programme"
        );
        // Past the end is an empty page, not a panic — a UI walks to exhaustion.
        assert!(contract.list_programmes(Some(9), Some(2)).is_empty());
    }

    #[test]
    fn a_request_for_everything_is_clamped_to_one_page() {
        let programmes = (0..250)
            .map(|id| {
                let mut programme = make_programme();
                programme.id = id;
                programme
            })
            .collect();
        let contract = contract_with(programmes, vec![]);
        assert_eq!(
            contract.list_programmes(Some(0), Some(u64::MAX)).len(),
            MAX_PAGE as usize,
            "an unbounded limit is clamped, not honoured"
        );
        assert_eq!(
            contract.list_programmes(None, None).len(),
            DEFAULT_PAGE as usize,
            "no limit means one default page, not the whole table"
        );
    }

    #[test]
    fn stats_count_outcomes_and_report_the_money() {
        let contract = contract_with(
            vec![programme_balances(1_000, 500)],
            tips([
                TipStatus::Submitted,
                TipStatus::UnderReview,
                TipStatus::Unfunded,
                TipStatus::Accepted { reward: U128(400) },
                TipStatus::Rejected,
                TipStatus::Dismissed,
                TipStatus::Paid,
                TipStatus::Retracted,
            ]),
        );
        let stats = contract.get_programme_stats(0);
        assert_eq!(stats.balance, U128(1_000));
        assert_eq!(stats.reserved, U128(500));
        assert_eq!(stats.submitted, 1);
        assert_eq!(
            stats.under_review, 2,
            "Unfunded is still in the review queue"
        );
        assert_eq!(stats.accepted, 1);
        assert_eq!(stats.rejected, 2);
        assert_eq!(stats.paid, 1);
        assert_eq!(stats.keeper_last_seen, U64(0));
    }

    /// Another programme's tips must not leak into these counts.
    #[test]
    fn stats_only_count_the_asked_for_programme() {
        let mut tip = make_tip();
        tip.id = 0;
        tip.programme_id = 1;
        let contract = contract_with(vec![make_programme()], vec![tip]);
        assert_eq!(contract.get_programme_stats(0).submitted, 0);
    }

    #[test]
    #[should_panic(expected = "E01_PROGRAMME_NOT_FOUND")]
    fn stats_for_a_missing_programme_is_an_error_not_zeros() {
        let contract = four_programmes();
        contract.get_programme_stats(42);
    }

    /// The privacy invariant, as a test: the public view is what an anonymous page can read, so it
    /// must not carry the evidence CID, the hash, the sealed-key pointers or the claim key.
    #[test]
    fn the_public_view_carries_no_pointer_to_the_evidence() {
        let mut tip = make_tip();
        tip.switch = Some(crate::types::Switch {
            interval: U64(HOUR_NS),
            grace: U64(HOUR_NS),
            next_deadline: U64(7 * HOUR_NS),
            bundle_key_for_keeper: "keeper-cid".to_string(),
            includes_raw: false,
            triggered: true,
        });
        let contract = contract_with(vec![make_programme()], vec![tip]);
        let public = contract.get_tip_public(0).expect("tip");
        assert_eq!(public.programme_id, 0);
        assert_eq!(public.status, TipStatus::Submitted);
        assert_eq!(public.submitted_at, U64(HOUR_NS));
        assert_eq!(public.switch_deadline, Some(U64(7 * HOUR_NS)));
        assert!(public.switch_triggered);

        let serialized = near_sdk::serde_json::to_string(&public).expect("view serializes");
        for leak in [
            "0a1b2c",            // evidence_cid
            &hex(EVIDENCE_HASH), // evidence_hash
            "sealed-1",          // sealed-key CID
            "keeper-cid",        // switch bundle CID
            "panel-1.testnet",   // who holds a key
            "claim_pubkey",      // the tipster's key at all
            "cleaning_report_hash",
        ] {
            assert!(
                !serialized.contains(leak),
                "get_tip_public leaked {leak:?}: {serialized}"
            );
        }
    }

    /// A tip with no switch has no deadline to report — and `switch_triggered` must not default to
    /// true for it.
    #[test]
    fn a_tip_without_a_switch_reports_no_deadline() {
        let contract = contract_with(vec![make_programme()], vec![make_tip()]);
        let public = contract.get_tip_public(0).expect("tip");
        assert_eq!(public.switch_deadline, None);
        assert!(!public.switch_triggered);
    }

    #[test]
    fn the_panel_view_is_the_only_one_with_cids() {
        let contract = contract_with(vec![make_programme()], vec![make_tip()]);
        let panel = contract.get_tip_for_panel(0).expect("tip");
        assert_eq!(panel.evidence_cid, "0a1b2c");
        assert_eq!(panel.sealed_keys.len(), 2);
        assert_eq!(contract.get_tip_for_panel(9), None);
    }

    /// The rule this view exists for: a tipster arming a switch seals `K_switch` to the keeper's key, and
    /// the only keeper that will ever answer is the one the chain appointed. So the key must be readable
    /// from the chain, and a rotation must show up here on the next read rather than live in whatever the
    /// page was built with — a stale key costs the tipster their switch, at the worst possible moment.
    #[test]
    fn the_keeper_key_offers_for_a_switch_is_the_one_the_chain_appointed() {
        let mut contract = four_programmes();
        let before = contract.get_keeper_info();
        assert_eq!(before.keeper, keeper());
        assert_eq!(before.keeper_x25519_pub, KEEPER_X25519);
        assert_eq!(before.keeper_last_seen, U64(0));

        as_caller(owner());
        contract.set_keeper(acct("keeper-2.testnet"), [9; 32]);
        let after = contract.get_keeper_info();
        assert_eq!(after.keeper, acct("keeper-2.testnet"));
        assert_eq!(after.keeper_x25519_pub, [9; 32]);
        assert_eq!(
            after.keeper_last_seen,
            U64(0),
            "a rotated keeper has not heartbeated, and this view is where a page learns that"
        );
    }

    /// The keeper's public half is a key in name only: it is the half meant to be given away, and the
    /// numbers beside it are already public. Naming it here keeps a future edit from treating the view as
    /// a place to add something private — the tipster's page reaches it with no wallet and no session.
    #[test]
    fn the_keeper_view_carries_nothing_a_wallet_is_needed_to_read() {
        let contract = four_programmes();
        let serialized =
            near_sdk::serde_json::to_string(&contract.get_keeper_info()).expect("view serializes");
        assert_eq!(
            serialized.matches(':').count(),
            3,
            "keeper identity, public half and liveness only: {serialized}"
        );
        assert!(!serialized.contains("x25519_sec"));
        assert!(!serialized.contains("0a1b2c"));
    }

    fn hex(bytes: [u8; 32]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// `TipStatus::Accepted` carries the reward, which is public once the DAO has decided —
    /// check it survives the projection rather than being dropped by it.
    #[test]
    fn a_resolved_reward_is_visible_publicly() {
        let contract = contract_with(
            vec![make_programme()],
            tips([TipStatus::Accepted { reward: U128(42) }]),
        );
        assert_eq!(
            contract.get_tip_public(0).unwrap().status,
            TipStatus::Accepted { reward: U128(42) }
        );
    }
}
