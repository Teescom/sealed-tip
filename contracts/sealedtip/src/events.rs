//! NEP-297 events, standard `sealedtip`, v1.0.0 (ARCHITECTURE §10). No event may carry tipster data.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::types::{ProgrammeId, TipId};

pub const STANDARD: &str = "sealedtip";
pub const VERSION: &str = "1.0.0";

#[near(serializers = [json])]
#[derive(Clone, Debug)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum SealedTipEvent {
    ProgrammeCreated { programme_id: ProgrammeId, funder: AccountId },
    ProgrammeFunded { programme_id: ProgrammeId, amount: U128 },
    ProgrammeClosed { programme_id: ProgrammeId },
    TipSubmitted { tip_id: TipId, programme_id: ProgrammeId },
    TipTriaged { tip_id: TipId, credible: bool },
    TipUnfunded { tip_id: TipId },
    TipRetracted { tip_id: TipId },
    Checkin { tip_id: TipId },
    SwitchTriggered { tip_id: TipId },
    KeysReleased { tip_id: TipId },
    TipResolved { tip_id: TipId, accepted: bool, reward: U128 },
    TipPaid { tip_id: TipId, amount: U128 },
    PanelSet { programme_id: ProgrammeId },
    KeeperHeartbeat {},
}

pub fn emit(event: SealedTipEvent) {
    let _ = event;
    todo!("S-2.2")
}
