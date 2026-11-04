// Proof-of-work: find pow_nonce so sha256(evidence_hash ‖ u64le(nonce)) has ≥ bits leading zeros (S-6.6).
export const solvePow = async (_evidenceHash: Uint8Array, _bits: number): Promise<bigint> => {
  throw new Error("not implemented: S-6.6");
};
export const checkPow = (_evidenceHash: Uint8Array, _nonce: bigint, _bits: number): boolean => {
  throw new Error("not implemented: S-6.6");
};
