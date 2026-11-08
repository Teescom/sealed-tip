// Proof-of-work: find pow_nonce so sha256(evidence_hash ‖ u64le(nonce)) has ≥ bits leading zeros (S-6.6).
// The layout is the contract's: `contracts/sealedtip/src/pow.rs` hashes the same 40 bytes and counts
// the same bits, and the vector in `fixtures/vectors.json` is what keeps the two from drifting apart.
import { sha256 } from "@noble/hashes/sha2.js";

/** Bits that are zero from the most significant bit down, capped at 256 for an all-zero hash. */
export const leadingZeroBits = (hash: Uint8Array): number => {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
};

/** `sha256(evidence_hash ‖ u64le(pow_nonce))` — the little-endian nonce is what the contract reads. */
export const powHash = (evidenceHash: Uint8Array, nonce: bigint): Uint8Array => {
  if (evidenceHash.length !== 32) {
    throw new RangeError(`evidence hash must be 32 bytes, got ${evidenceHash.length}`);
  }
  if (nonce < 0n || nonce > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`pow nonce must fit a u64, got ${nonce}`);
  }
  const preimage = new Uint8Array(40);
  preimage.set(evidenceHash, 0);
  const view = new DataView(preimage.buffer);
  view.setBigUint64(32, nonce, true);
  return sha256(preimage);
};

export const checkPow = (evidenceHash: Uint8Array, nonce: bigint, bits: number): boolean =>
  leadingZeroBits(powHash(evidenceHash, nonce)) >= bits;

/**
 * Smallest nonce that clears `bits`, counting up from 0.
 *
 * Yields to the event loop every 64 Ki hashes: the tipster's browser is the machine doing this work,
 * and a tab that locks up for a minute looks like a broken product rather than like mining.
 */
export const solvePow = async (evidenceHash: Uint8Array, bits: number): Promise<bigint> => {
  if (!Number.isInteger(bits) || bits < 0 || bits > 256) {
    throw new RangeError(`pow difficulty must be a whole number of bits within 0..=256, got ${bits}`);
  }
  for (let nonce = 0n; nonce <= 0xffff_ffff_ffff_ffffn; nonce++) {
    if (leadingZeroBits(powHash(evidenceHash, nonce)) >= bits) return nonce;
    if (nonce % 65536n === 65535n) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`no u64 nonce reached ${bits} leading zero bits for this evidence hash`);
};
