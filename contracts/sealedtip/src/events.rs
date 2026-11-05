//! NEP-297 events, standard `sealedtip`, v1.0.0 (ARCHITECTURE §10). No event may carry tipster data.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::types::{ProgrammeId, TipId};

pub const STANDARD: &str = "sealedtip";
pub const VERSION: &str = "1.0.0";

#[near(event_json(standard = "sealedtip"))]
#[derive(Debug)]
pub enum SealedTipEvent {
    #[event_version("1.0.0")]
    ProgrammeCreated {
        programme_id: ProgrammeId,
        funder: AccountId,
    },
    #[event_version("1.0.0")]
    ProgrammeFunded {
        programme_id: ProgrammeId,
        amount: U128,
    },
    #[event_version("1.0.0")]
    ProgrammeClosed { programme_id: ProgrammeId },
    #[event_version("1.0.0")]
    TipSubmitted {
        tip_id: TipId,
        programme_id: ProgrammeId,
    },
    #[event_version("1.0.0")]
    TipTriaged { tip_id: TipId, credible: bool },
    /// Emitted alongside `tip_triaged (credible: false)`; §10 lists both names.
    #[event_version("1.0.0")]
    TipDismissed { tip_id: TipId },
    #[event_version("1.0.0")]
    TipUnfunded { tip_id: TipId },
    #[event_version("1.0.0")]
    TipRetracted { tip_id: TipId },
    #[event_version("1.0.0")]
    Checkin { tip_id: TipId },
    #[event_version("1.0.0")]
    SwitchTriggered { tip_id: TipId },
    #[event_version("1.0.0")]
    KeysReleased { tip_id: TipId },
    #[event_version("1.0.0")]
    TipResolved {
        tip_id: TipId,
        accepted: bool,
        reward: U128,
    },
    #[event_version("1.0.0")]
    TipPaid { tip_id: TipId, amount: U128 },
    #[event_version("1.0.0")]
    PanelSet { programme_id: ProgrammeId },
    #[event_version("1.0.0")]
    KeeperHeartbeat {},
}

/// The single place this contract writes a log line (AGENTS "events").
pub fn emit(event: SealedTipEvent) {
    event.emit();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{as_caller, funder, keeper};
    use near_sdk::serde_json::Value;
    use near_sdk::test_utils::get_logs;
    use near_sdk::AsNep297Event;

    /// Every variant, with the event name and data fields it must produce.
    fn every_event() -> Vec<(SealedTipEvent, &'static str, Vec<&'static str>)> {
        vec![
            (
                SealedTipEvent::ProgrammeCreated {
                    programme_id: 7,
                    funder: funder(),
                },
                "programme_created",
                vec!["funder", "programme_id"],
            ),
            (
                SealedTipEvent::ProgrammeFunded {
                    programme_id: 7,
                    amount: U128(1_000),
                },
                "programme_funded",
                vec!["amount", "programme_id"],
            ),
            (
                SealedTipEvent::ProgrammeClosed { programme_id: 7 },
                "programme_closed",
                vec!["programme_id"],
            ),
            (
                SealedTipEvent::TipSubmitted {
                    tip_id: 3,
                    programme_id: 7,
                },
                "tip_submitted",
                vec!["programme_id", "tip_id"],
            ),
            (
                SealedTipEvent::TipTriaged {
                    tip_id: 3,
                    credible: true,
                },
                "tip_triaged",
                vec!["credible", "tip_id"],
            ),
            (
                SealedTipEvent::TipDismissed { tip_id: 3 },
                "tip_dismissed",
                vec!["tip_id"],
            ),
            (
                SealedTipEvent::TipUnfunded { tip_id: 3 },
                "tip_unfunded",
                vec!["tip_id"],
            ),
            (
                SealedTipEvent::TipRetracted { tip_id: 3 },
                "tip_retracted",
                vec!["tip_id"],
            ),
            (
                SealedTipEvent::Checkin { tip_id: 3 },
                "checkin",
                vec!["tip_id"],
            ),
            (
                SealedTipEvent::SwitchTriggered { tip_id: 3 },
                "switch_triggered",
                vec!["tip_id"],
            ),
            (
                SealedTipEvent::KeysReleased { tip_id: 3 },
                "keys_released",
                vec!["tip_id"],
            ),
            (
                SealedTipEvent::TipResolved {
                    tip_id: 3,
                    accepted: true,
                    reward: U128(500),
                },
                "tip_resolved",
                vec!["accepted", "reward", "tip_id"],
            ),
            (
                SealedTipEvent::TipPaid {
                    tip_id: 3,
                    amount: U128(500),
                },
                "tip_paid",
                vec!["amount", "tip_id"],
            ),
            (
                SealedTipEvent::PanelSet { programme_id: 7 },
                "panel_set",
                vec!["programme_id"],
            ),
            (
                SealedTipEvent::KeeperHeartbeat {},
                "keeper_heartbeat",
                vec![],
            ),
        ]
    }

    fn sorted(mut names: Vec<&str>) -> Vec<String> {
        names.sort_unstable();
        names.into_iter().map(String::from).collect()
    }

    #[test]
    fn event_names_are_exactly_the_architecture_section_10_list() {
        // ARCHITECTURE.md §10 is the published contract; a new or renamed variant breaks indexers.
        let documented = sorted(vec![
            "programme_created",
            "programme_funded",
            "programme_closed",
            "tip_submitted",
            "tip_triaged",
            "tip_dismissed",
            "tip_unfunded",
            "tip_retracted",
            "checkin",
            "switch_triggered",
            "keys_released",
            "tip_resolved",
            "tip_paid",
            "panel_set",
            "keeper_heartbeat",
        ]);
        let mut emitted: Vec<String> = every_event()
            .iter()
            .map(|(e, _, _)| e.to_nep297_event().event().to_string())
            .collect();
        emitted.sort();
        assert_eq!(emitted, documented);
    }

    #[test]
    fn every_event_carries_the_sealedtip_standard_and_version() {
        for (event, name, _) in every_event() {
            let nep = event.to_nep297_event();
            assert_eq!(nep.standard(), STANDARD, "{name}");
            assert_eq!(nep.version(), VERSION, "{name}");
            assert_eq!(nep.event(), name);
        }
    }

    #[test]
    fn no_event_data_field_is_tipster_material() {
        let forbidden = [
            "cid",
            "hash",
            "pubkey",
            "sealed",
            "evidence",
            "attestation",
            "signature",
            "nonce",
            "payout",
            "switch",
            "recused",
        ];
        for (event, name, expected_fields) in every_event() {
            let data = event
                .to_nep297_event()
                .data()
                .unwrap_or_else(|| panic!("{name} has no data object"));
            let object = data
                .as_object()
                .unwrap_or_else(|| panic!("{name} data is not an object"));
            let keys: Vec<String> = sorted(object.keys().map(String::as_str).collect());
            assert_eq!(keys, sorted(expected_fields), "unexpected fields on {name}");
            for key in keys {
                for needle in forbidden {
                    assert!(
                        !key.contains(needle),
                        "{name} leaks tipster material through `{key}`"
                    );
                }
            }
        }
    }

    #[test]
    fn amounts_are_decimal_strings_not_floats() {
        // U128 must stay a string so a 1e24 reward survives the round trip.
        let data = SealedTipEvent::TipPaid {
            tip_id: 3,
            amount: U128(u128::MAX),
        }
        .to_nep297_event()
        .data()
        .unwrap();
        assert_eq!(data["amount"], Value::String(u128::MAX.to_string()));
    }

    #[test]
    fn emit_helper_writes_exactly_one_event_json_log_line() {
        as_caller(keeper());
        emit(SealedTipEvent::KeeperHeartbeat {});
        let logs = get_logs();
        assert_eq!(logs.len(), 1, "one state change, one log line");
        let json: Value = near_sdk::serde_json::from_str(
            logs[0].strip_prefix("EVENT_JSON:").expect("NEP-297 prefix"),
        )
        .expect("log line is JSON");
        assert_eq!(json["standard"], Value::String(STANDARD.to_string()));
        assert_eq!(json["event"], Value::String("keeper_heartbeat".to_string()));
    }

    #[test]
    fn a_tip_event_names_no_account_at_all() {
        // The claim that keeps a tipster anonymous: nothing in a tip event identifies a caller.
        as_caller(funder());
        emit(SealedTipEvent::TipSubmitted {
            tip_id: 3,
            programme_id: 7,
        });
        let logs = get_logs();
        let line = logs.last().expect("a log line");
        for account in [funder().as_str(), keeper().as_str(), "panel-1.testnet"] {
            assert!(!line.contains(account), "tip event leaked {account}");
        }
        assert!(
            !line.contains("sealed-1"),
            "tip event leaked a sealed-key pointer"
        );
    }
}
