//! Every error code + message. Messages must never include tipster data.

pub const E01_PROGRAMME_NOT_FOUND: &str = "E01_PROGRAMME_NOT_FOUND: programme does not exist";
pub const E02_TIP_NOT_FOUND: &str = "E02_TIP_NOT_FOUND: tip does not exist";
pub const E03_NOT_FUNDER: &str = "E03_NOT_FUNDER: only the funder can call this";
pub const E04_NOT_RELAYER: &str = "E04_NOT_RELAYER: caller is not an allow-listed relayer";
pub const E05_NOT_PANEL_DAO: &str = "E05_NOT_PANEL_DAO: only the panel DAO can call this";
pub const E06_NOT_PANEL_MEMBER: &str =
    "E06_NOT_PANEL_MEMBER: caller is not a non-recused panel member";
pub const E07_NOT_KEEPER: &str = "E07_NOT_KEEPER: caller is not the keeper";
pub const E08_NOT_OWNER: &str = "E08_NOT_OWNER: caller is not the owner";
pub const E09_BAD_SIGNATURE: &str = "E09_BAD_SIGNATURE: signature does not verify";
pub const E10_BAD_NONCE: &str = "E10_BAD_NONCE: nonce must be the last nonce + 1";
pub const E11_POW_TOO_LOW: &str = "E11_POW_TOO_LOW: proof-of-work below the required bits";
pub const E12_TOO_FEW_SEALED_KEYS: &str =
    "E12_TOO_FEW_SEALED_KEYS: at least 2 non-recused sealed keys required";
pub const E13_SEALED_TO_RECUSED: &str =
    "E13_SEALED_TO_RECUSED: a sealed key belongs to a recused member";
pub const E14_INVALID_STATUS: &str =
    "E14_INVALID_STATUS: tip is not in a valid status for this action";
pub const E15_REWARD_TOO_HIGH: &str = "E15_REWARD_TOO_HIGH: reward exceeds max_reward";
pub const E16_RESERVED_FUNDS: &str = "E16_RESERVED_FUNDS: amount exceeds unreserved balance";
pub const E17_PROGRAMME_CLOSED: &str = "E17_PROGRAMME_CLOSED: programme is closed";
pub const E18_SWITCH_NOT_DUE: &str = "E18_SWITCH_NOT_DUE: switch deadline + grace has not passed";
pub const E19_NO_SWITCH: &str = "E19_NO_SWITCH: tip has no switch";
pub const E20_NOT_TRIGGERED: &str = "E20_NOT_TRIGGERED: switch has not been triggered";
pub const E21_WRONG_TOKEN: &str = "E21_WRONG_TOKEN: token is not this programme's token";
pub const E22_INVALID_MESSAGE: &str = "E22_INVALID_MESSAGE: ft_on_transfer message is invalid";
pub const E23_TIME_SCALE_IMMUTABLE: &str = "E23_TIME_SCALE_IMMUTABLE: time_scale cannot be changed";
pub const E24_INSUFFICIENT_DEPOSIT: &str =
    "E24_INSUFFICIENT_DEPOSIT: attached deposit does not cover storage and ops balance";
pub const E25_INVALID_TIME_SCALE: &str =
    "E25_INVALID_TIME_SCALE: time_scale must be at least 1 nanosecond per nanosecond";
/// NEP-141: the receiver may get 0 yoctoNEAR (our token) or the 1 yoctoNEAR a sender is required to
/// attach, and it is gas, never value. Anything more means the caller thinks NEAR buys a reservation.
pub const E26_RECEIVER_DEPOSIT: &str =
    "E26_RECEIVER_DEPOSIT: ft_on_transfer may carry at most the 1 yoctoNEAR NEP-141 forwards";
/// B9: one relayer is a single point of failure and can censor every tipster action.
pub const E27_TOO_FEW_RELAYERS: &str =
    "E27_TOO_FEW_RELAYERS: relayers must contain at least 2 distinct accounts";
/// A tip needs ≥2 sealed keys (B10), so a programme can never be reviewable by fewer than 2 people.
pub const E28_TOO_FEW_PANEL_MEMBERS: &str =
    "E28_TOO_FEW_PANEL_MEMBERS: panel must contain at least 2 distinct members";
/// Releasing more than is reserved means the reservation bookkeeping is already wrong; it is never
/// a caller's fault, so it must stop the transaction rather than quietly hand the funder a balance.
pub const E29_RESERVATION_UNDERFLOW: &str =
    "E29_RESERVATION_UNDERFLOW: reservation accounting is inconsistent";
pub const E30_BALANCE_OVERFLOW: &str = "E30_BALANCE_OVERFLOW: token amount would overflow";
/// `resolve_tip(tip_id, false, Some(reward))` has no honest meaning: a rejected tip pays nothing, so
/// a number attached to it is either a caller who thinks rejection is negotiable or a caller that has
/// mixed up the two branches. Refusing beats reading it as zero and carrying on.
pub const E31_REWARD_ON_REJECT: &str = "E31_REWARD_ON_REJECT: a rejected tip cannot carry a reward";
