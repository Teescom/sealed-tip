// libsodium: XChaCha20-Poly1305 for bundles, sealed boxes (X25519) for keys (S-6.5). Browser-only plaintext.
//
// Two different jobs, and the split is the privacy design:
//   - the *bundle* is one ciphertext anybody can hold, because it is meaningless without K;
//   - K itself travels only inside sealed boxes, one per recipient, so the blob store and the relayers
//     never see who is allowed to read a tip.
import sodium from "libsodium-wrappers";

import { sha256 } from "@noble/hashes/sha2.js";

const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
/** The ephemeral public key (32) and the Poly1305 tag (16); the nonce is hashed out of the two keys. */
const SEAL_BYTES = 48;

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * `K = rand32; ct = XChaCha20-Poly1305(K, bundle)`. The nonce is random per call and sits in front of
 * the ciphertext, so `decryptBundle` needs nothing but K and the bytes it was given — which is what a
 * blob store can hand back.
 */
export const encryptBundle = async (plaintext: Uint8Array): Promise<{ key: Uint8Array; ciphertext: Uint8Array }> => {
  await sodium.ready;
  const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const box = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, null, null, nonce, key);
  const ciphertext = new Uint8Array(NONCE_BYTES + box.length);
  ciphertext.set(nonce, 0);
  ciphertext.set(box, NONCE_BYTES);
  return { key, ciphertext };
};

export const decryptBundle = async (key: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> => {
  await sodium.ready;
  if (key.length !== KEY_BYTES) throw new RangeError(`bundle key must be ${KEY_BYTES} bytes, got ${key.length}`);
  if (ciphertext.length < NONCE_BYTES + TAG_BYTES) {
    throw new RangeError(`ciphertext is ${ciphertext.length} bytes, too short to hold a nonce and a tag`);
  }
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext.subarray(NONCE_BYTES),
    null,
    ciphertext.subarray(0, NONCE_BYTES),
    key,
  );
};

/** Anonymous encryption to one recipient's X25519 key — the shape a `SealedKey.cid` points at. */
export const sealTo = async (message: Uint8Array, x25519Pub: Uint8Array): Promise<Uint8Array> => {
  await sodium.ready;
  if (x25519Pub.length !== KEY_BYTES) {
    throw new RangeError(`x25519 public key must be ${KEY_BYTES} bytes, got ${x25519Pub.length}`);
  }
  return sodium.crypto_box_seal(message, x25519Pub);
};

export const openSealed = async (
  sealed: Uint8Array,
  x25519Pub: Uint8Array,
  x25519Secret: Uint8Array,
): Promise<Uint8Array> => {
  await sodium.ready;
  if (sealed.length < SEAL_BYTES) {
    throw new RangeError(`sealed box is ${sealed.length} bytes, shorter than a sealed box can be`);
  }
  return sodium.crypto_box_seal_open(sealed, x25519Pub, x25519Secret);
};

/** cid = hex sha256(ciphertext) */
export const cidOf = (ciphertext: Uint8Array): string => hex(sha256(ciphertext));
