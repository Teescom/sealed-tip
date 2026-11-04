//! Proof-of-work check: sha256(evidence_hash ‖ pow_nonce) has ≥ pow_bits leading zero bits. (S-2.5)

use crate::types::CryptoHash;

pub fn leading_zero_bits(hash: &CryptoHash) -> u32 {
    let _ = hash;
    todo!("S-2.5")
}

pub fn check(evidence_hash: &CryptoHash, pow_nonce: u64, pow_bits: u8) -> bool {
    let _ = (evidence_hash, pow_nonce, pow_bits);
    todo!("S-2.5")
}
