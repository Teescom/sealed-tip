// Claim secret: 32 random bytes shown as 24 BIP39 words (entropy only, no HD paths) (S-6.3).
// Runs in the browser only — the secret never reaches Sealed Tip's servers.
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import sodium from "libsodium-wrappers";

import { ed } from "./ed25519.js";

export const ED25519_LABEL = "sealedtip/ed25519/v1";
export const X25519_LABEL = "sealedtip/x25519/v1";

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface TipsterKeys {
  ed25519: KeyPair;
  x25519: KeyPair;
}

export const newSecret = (): Uint8Array => {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return secret;
};

export const secretToWords = (secret: Uint8Array): string[] => {
  if (secret.length !== 32) throw new RangeError(`claim secret must be 32 bytes, got ${secret.length}`);
  return entropyToMnemonic(secret, wordlist).split(" ");
};

/** Throws on a bad word list or checksum — that is the user's "these aren't my words" path. */
export const wordsToSecret = (words: string[]): Uint8Array =>
  mnemonicToEntropy(words.join(" ").trim().toLowerCase(), wordlist);

// Absent and empty passphrase must derive the same key, or a tipster's words stop working.
const saltBytes = (passphrase?: string): Uint8Array =>
  passphrase === undefined || passphrase.length === 0
    ? new Uint8Array(0)
    : new TextEncoder().encode(passphrase);

const derive = (secret: Uint8Array, label: string, salt: Uint8Array): Uint8Array =>
  hkdf(sha256, secret, salt, new TextEncoder().encode(label), 32);

export const deriveKeys = async (secret: Uint8Array, passphrase?: string): Promise<TipsterKeys> => {
  if (secret.length !== 32) throw new RangeError(`claim secret must be 32 bytes, got ${secret.length}`);
  const salt = saltBytes(passphrase);
  const edSecretKey = derive(secret, ED25519_LABEL, salt);
  const x25519SecretKey = derive(secret, X25519_LABEL, salt);
  await sodium.ready;
  return {
    ed25519: { secretKey: edSecretKey, publicKey: ed.getPublicKey(edSecretKey) },
    x25519: { secretKey: x25519SecretKey, publicKey: sodium.crypto_scalarmult_base(x25519SecretKey) },
  };
};

/**
 * The X25519 public half on its own, for the identities a deployment *registers* rather than derives —
 * the keeper and the panel members, whose public keys the contract stores as `[u8; 32]`.
 */
export const x25519PublicKey = async (secretKey: Uint8Array): Promise<Uint8Array> => {
  if (secretKey.length !== 32) throw new RangeError(`x25519 secret key must be 32 bytes, got ${secretKey.length}`);
  await sodium.ready;
  return sodium.crypto_scalarmult_base(secretKey);
};

export const newX25519KeyPair = async (): Promise<KeyPair> => {
  await sodium.ready;
  const secretKey = sodium.randombytes_buf(32);
  return { secretKey, publicKey: sodium.crypto_scalarmult_base(secretKey) };
};
