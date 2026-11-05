//! The ONLY place durations are computed. Applies `Programme::time_scale`. (S-2.3)

use crate::errors::E25_INVALID_TIME_SCALE;
use near_sdk::require;

/// `duration_ns` compressed for demo mode: scale 1 is real time, 1440 is one day per minute.
pub fn scaled(duration_ns: u64, time_scale: u32) -> u64 {
    require!(time_scale != 0, E25_INVALID_TIME_SCALE);
    duration_ns / u64::from(time_scale)
}

/// Absolute deadline (`now_ns + scaled(duration)`) for a switch interval or check-in.
pub fn deadline(now_ns: u64, duration_ns: u64, time_scale: u32) -> u64 {
    now_ns
        .checked_add(scaled(duration_ns, time_scale))
        .expect("deadline overflows u64 nanoseconds")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::HOUR_NS;

    const DAY_NS: u64 = 24 * HOUR_NS;

    #[test]
    fn scale_one_is_real_time() {
        assert_eq!(scaled(DAY_NS, 1), DAY_NS);
    }

    #[test]
    fn demo_mode_compresses_a_day_into_a_minute() {
        assert_eq!(scaled(DAY_NS, 1440), 60_000_000_000);
    }

    #[test]
    fn scaling_rounds_down_never_up() {
        // A caller must not get a longer deadline than they asked for.
        assert_eq!(scaled(10, 3), 3);
        assert_eq!(scaled(1, 2), 0);
    }

    #[test]
    fn zero_duration_is_zero_at_any_scale() {
        assert_eq!(scaled(0, 1), 0);
        assert_eq!(scaled(0, 1_000_000), 0);
    }

    #[test]
    #[should_panic(expected = "E25_INVALID_TIME_SCALE")]
    fn scale_zero_is_rejected_instead_of_dividing_by_zero() {
        scaled(DAY_NS, 0);
    }

    #[test]
    fn deadline_adds_the_scaled_duration_to_now() {
        assert_eq!(deadline(DAY_NS, HOUR_NS, 1), 25 * HOUR_NS);
        assert_eq!(deadline(DAY_NS, DAY_NS, 1440), DAY_NS + 60_000_000_000);
    }

    #[test]
    fn deadline_panics_instead_of_wrapping() {
        std::panic::catch_unwind(|| deadline(u64::MAX, 1, 1)).expect_err("overflow must not wrap");
    }
}
