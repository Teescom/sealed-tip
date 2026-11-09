// Turning a `TipBundle` into the four values `submit_tip` is called with (ARCHITECTURE §6, S-10.4).
//
// This is the seam between the container (`@sealedtip/core` describes it) and the wire (`packages/crypto`
// already owns the cipher, the CID rule and the domain hashes). It lives in the crypto package rather than in
// `apps/web` for one reason: the panel's browser and `pnpm demo` have to rebuild the same bytes from the same
// bundle to check the hashes the chain recorded, and a third program cannot import a page's helper.
//
// Two choices are recorded here because they are the ones a reader would otherwise have to guess:
//
//   - `evidence_hash = sha256(ciphertext)`, which is the same 32 bytes as the CID in a different encoding.
//     It could have been sha256 of the plaintext bundle — the panel would still be able to recompute it — but
//     a content hash is a link: two tips that quote the same document would share one `evidence_hash` on
//     chain, and that is a deanonymisation vector built into a field whose only stated job is to be the PoW
//     preimage. A ciphertext hash is randomised per submission by `K` and the nonce, so it links nothing.
//   - The serialized bundle is `canonicalJson`, the same writer the attestation hash uses: sorted keys and no
//     `undefined`. `JSON.stringify` alone would make the hash depend on the order fields happened to be set
//     in, which is a hash nobody can reproduce a week later.
import { sha256 } from "@noble/hashes/sha2.js";
import sodium from "libsodium-wrappers";

import { BundleReport, TipBundle } from "@sealedtip/core";

import { canonicalJson } from "./attestation.js";
import { cidOf, decryptBundle, encryptBundle } from "./seal.js";

/** One bundle, its key, and the two identities the chain gets told about it. */
export interface SealedBundle {
  /** `K`: the 32 bytes that open `ciphertext`, and the only thing that travels inside a sealed box. */
  readonly key: Uint8Array;
  readonly ciphertext: Uint8Array;
  /** `hex sha256(ciphertext)` — what `evidence_cid` and every `SealedKey.cid` point at. */
  readonly cid: string;
  /** `sha256(ciphertext)` as bytes: the PoW preimage and the field the submit signature binds. */
  readonly hash: Uint8Array;
}

/** The canonical text of a bundle: what gets hashed, and what the panel re-hashes after decrypting. */
export const bundleText = (bundle: TipBundle): string => canonicalJson(TipBundle.parse(bundle));

export const bundleBytes = (bundle: TipBundle): Uint8Array => new TextEncoder().encode(bundleText(bundle));

/**
 * Encrypt a bundle exactly as `submit_tip` expects it: key out of libsodium's own generator, nonce in front
 * of the ciphertext, and the CID and evidence hash both derived from those same bytes.
 *
 * The schema parse happens before anything is spent, because a bundle that fails validation after upload
 * leaves ciphertext in a store nobody can point at.
 */
export const sealBundle = async (bundle: TipBundle): Promise<SealedBundle> => {
  const text = bundleText(bundle);
  const { key, ciphertext } = await encryptBundle(new TextEncoder().encode(text));
  return { key, ciphertext, cid: cidOf(ciphertext), hash: Uint8Array.from(sha256(ciphertext)) };
};

/** Open what the store handed back, and refuse anything that is not a bundle this code would have written. */
export const openBundle = async (key: Uint8Array, ciphertext: Uint8Array): Promise<TipBundle> =>
  TipBundle.parse(JSON.parse(new TextDecoder().decode(await decryptBundle(key, ciphertext))) as unknown);

/**
 * `cleaning_report_hash`: sha256 over the canonical report.
 *
 * A panel member comparing this against a report they were sent can prove the list of removed fields is the
 * one the tipster committed to, which is the only way "the cleaner said it stripped the GPS" means anything
 * after the file has left the browser.
 */
export const reportHash = (report: BundleReport): Uint8Array =>
  Uint8Array.from(sha256(new TextEncoder().encode(canonicalJson(BundleReport.parse(report)))));

/** A 64-hex digest from `attestationHashOf` into the `[u8; 32]` the wire wants. */
export const bytes32FromHex = (hex: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new RangeError("expected 64 lowercase hex characters");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

/**
 * base64 for the bytes inside a bundle.
 *
 * libsodium rather than `Buffer` or `btoa`: this runs in a tipster's browser, where `Buffer` does not exist
 * and `btoa` throws on anything outside Latin-1 — which is most of a JPEG. The package already depends on
 * sodium for the cipher, so nothing new enters the bundle the tipster downloads.
 */
export const toBase64 = async (bytes: Uint8Array): Promise<string> => {
  await sodium.ready;
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
};

export const fromBase64 = async (text: string): Promise<Uint8Array> => {
  await sodium.ready;
  return sodium.from_base64(text, sodium.base64_variants.ORIGINAL);
};
