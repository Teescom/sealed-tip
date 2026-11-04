//! The ONLY place durations are computed. Applies `Programme::time_scale`. (S-2.3)

pub fn scaled(duration_ns: u64, time_scale: u32) -> u64 {
    let _ = (duration_ns, time_scale);
    todo!("S-2.3")
}
