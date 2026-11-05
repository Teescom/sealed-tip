//! Proof-of-work check: sha256(evidence_hash ‖ pow_nonce) has ≥ pow_bits leading zero bits. (S-2.5)

use near_sdk::env;

use crate::types::CryptoHash;

/// Bits that are zero from the most significant bit down, capped at 256 for an all-zero hash.
pub fn leading_zero_bits(hash: &CryptoHash) -> u32 {
    let mut bits = 0u32;
    for byte in hash.iter() {
        if *byte == 0 {
            bits += 8;
            continue;
        }
        bits += byte.leading_zeros();
        break;
    }
    bits
}

/// `sha256(evidence_hash ‖ u64le(pow_nonce))` must start with `pow_bits` zero bits.
/// The little-endian nonce is the layout `packages/crypto/src/pow.ts` solves for.
pub fn check(evidence_hash: &CryptoHash, pow_nonce: u64, pow_bits: u8) -> bool {
    let mut preimage = Vec::with_capacity(evidence_hash.len() + 8);
    preimage.extend_from_slice(evidence_hash);
    preimage.extend_from_slice(&pow_nonce.to_le_bytes());
    leading_zero_bits(&env::sha256_array(&preimage)) >= u32::from(pow_bits)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Independent vector: sha256 of 32 × 0x11 followed by the u64 **little-endian** nonce 9.
    /// Computed with `node -e` / `shasum`, not by this contract, so it can catch a layout change.
    const EVIDENCE: CryptoHash = [0x11; 32];
    const NONCE: u64 = 9;
    const SHA256_LE_NONCE: [u8; 32] = [
        0x38, 0x49, 0x89, 0xa8, 0x4b, 0x29, 0xf7, 0x0c, 0x1b, 0x54, 0xb6, 0x20, 0x71, 0x1e, 0x4c,
        0xb8, 0x1a, 0x31, 0x2a, 0xd0, 0x89, 0x9f, 0x8e, 0xd5, 0xac, 0xfe, 0x53, 0x60, 0x0c, 0x54,
        0x33, 0xeb,
    ];
    /// Same inputs with a big-endian nonce — a different hash, and an easier one (7 zero bits).
    const SHA256_BE_NONCE: [u8; 32] = [
        0x01, 0x6b, 0xc2, 0xfb, 0xcd, 0xd6, 0x83, 0x7b, 0x01, 0xdd, 0xb3, 0xe3, 0x28, 0xe5, 0x7e,
        0x2d, 0x77, 0x86, 0x13, 0xa7, 0x29, 0xc6, 0xda, 0xc6, 0xaa, 0xc3, 0x19, 0x8c, 0x0d, 0x8a,
        0x8e, 0x9d,
    ];

    /// A hash that starts with `prefix`; the remaining bytes stay zero and never get looked at.
    fn starting_with(prefix: &[u8]) -> CryptoHash {
        let mut hash = [0u8; 32];
        hash[..prefix.len()].copy_from_slice(prefix);
        hash
    }

    #[test]
    fn leading_zero_bits_counts_from_the_most_significant_bit() {
        assert_eq!(leading_zero_bits(&[0x00; 32]), 256);
        assert_eq!(leading_zero_bits(&starting_with(&[0x80])), 0);
        assert_eq!(leading_zero_bits(&starting_with(&[0x01, 0xff])), 7);
        // two zero bytes (16) + 0x0f = 0000_1111 (4 more)
        assert_eq!(
            leading_zero_bits(&starting_with(&[0x00, 0x00, 0x0f, 0xff])),
            20
        );
    }

    #[test]
    fn the_shared_vector_has_two_leading_zero_bits() {
        assert_eq!(leading_zero_bits(&SHA256_LE_NONCE), 2);
        assert_eq!(leading_zero_bits(&SHA256_BE_NONCE), 7);
    }

    #[test]
    fn check_accepts_at_the_exact_difficulty_and_rejects_above() {
        assert!(check(&EVIDENCE, NONCE, 2));
        assert!(!check(&EVIDENCE, NONCE, 3));
    }

    #[test]
    fn the_nonce_is_u64_little_endian() {
        // Under a big-endian nonce this same tip would pass 5 bits; the contract must not.
        assert!(!check(&EVIDENCE, NONCE, 5));
    }

    #[test]
    fn zero_required_bits_is_always_satisfied() {
        assert!(check(&EVIDENCE, 0, 0));
        assert!(check(&[0xff; 32], u64::MAX, 0));
    }

    #[test]
    fn a_low_difficulty_is_brute_forceable_so_the_gate_is_real() {
        // Mirrors the client's solvePow (S-6.6): some nonce must exist for a small `pow_bits`.
        let nonce = (0u64..40_000)
            .find(|nonce| check(&EVIDENCE, *nonce, 8))
            .expect("no nonce < 40k has 8 zero bits");
        assert!(check(&EVIDENCE, nonce, 8));

        // The threshold is exact: `check` accepts up to the nonce's own bit count and no further.
        // Derived from `check` itself, so it cannot drift from the production layout.
        let achieved = (0u8..=64)
            .filter(|bits| check(&EVIDENCE, nonce, *bits))
            .count();
        assert!(check(&EVIDENCE, nonce, u8::try_from(achieved - 1).unwrap()));
        assert!(!check(&EVIDENCE, nonce, u8::try_from(achieved).unwrap()));
    }
}
