// Claim secret: 32 random bytes shown as 24 BIP39 words (entropy only, no HD paths) (S-6.3).
// Keys: HKDF-SHA256(secret, salt = optional passphrase) with labels below. Runs in the browser only.
export const ED25519_LABEL = "sealedtip/ed25519/v1";
export const X25519_LABEL = "sealedtip/x25519/v1";

export interface TipsterKeys {
  ed25519: { publicKey: Uint8Array; secretKey: Uint8Array };
  x25519: { publicKey: Uint8Array; secretKey: Uint8Array };
}

export const newSecret = (): Uint8Array => { throw new Error("not implemented: S-6.3"); };
export const secretToWords = (_secret: Uint8Array): string[] => { throw new Error("not implemented: S-6.3"); };
export const wordsToSecret = (_words: string[]): Uint8Array => { throw new Error("not implemented: S-6.3"); };
export const deriveKeys = (_secret: Uint8Array, _passphrase?: string): TipsterKeys => {
  throw new Error("not implemented: S-6.3");
};
