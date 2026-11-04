//! Role guards. (S-2.7)

use crate::types::{Programme, Tip};

pub fn assert_funder(p: &Programme) { let _ = p; todo!("S-2.7") }
pub fn assert_panel_dao(p: &Programme) { let _ = p; todo!("S-2.7") }
/// Caller ∈ programme.panel and ∉ tip.recused.
pub fn assert_panel_member(p: &Programme, t: &Tip) { let _ = (p, t); todo!("S-2.7") }
