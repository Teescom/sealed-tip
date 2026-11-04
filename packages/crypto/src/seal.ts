// libsodium: XChaCha20-Poly1305 for bundles, sealed boxes (X25519) for keys (S-6.5). Browser-only plaintext.
export const encryptBundle = async (_plaintext: Uint8Array): Promise<{ key: Uint8Array; ciphertext: Uint8Array }> => {
  throw new Error("not implemented: S-6.5");
};
export const decryptBundle = async (_key: Uint8Array, _ciphertext: Uint8Array): Promise<Uint8Array> => {
  throw new Error("not implemented: S-6.5");
};
export const sealTo = async (_message: Uint8Array, _x25519Pub: Uint8Array): Promise<Uint8Array> => {
  throw new Error("not implemented: S-6.5");
};
export const openSealed = async (_sealed: Uint8Array, _x25519Pub: Uint8Array, _x25519Secret: Uint8Array): Promise<Uint8Array> => {
  throw new Error("not implemented: S-6.5");
};
/** cid = hex sha256(ciphertext) */
export const cidOf = (_ciphertext: Uint8Array): string => { throw new Error("not implemented: S-6.5"); };
