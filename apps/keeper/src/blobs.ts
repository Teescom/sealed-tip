// The keeper's side of the ciphertext store, over the tip API's `/blob` routes (S-9.3).
//
// The keeper needs both halves: it reads the blob whose CID the tipster put in
// `switch.bundle_key_for_keeper` (their sealed copy of `K_switch`), and it writes one new sealed box per
// panel member it is releasing to, because `post_released_keys` stores pointers and a pointer to bytes
// nobody uploaded is a panel that cannot open the tip.
//
// It goes through the API rather than at a bucket because the API is the party that knows where blobs live
// (S-8.3) and because that path already refuses a body that opens as a PDF, JPEG or PNG header — the same
// backstop applies to what the keeper uploads, and a keeper that talked to the bucket directly would be a
// second implementation of the rule.
import { cidOf } from "@sealedtip/crypto";

export interface BlobIO {
  /** `null` for a CID the store does not have; a CID is opaque, so "not found" is a real answer. */
  get(cid: string): Promise<Uint8Array | null>;
  /** Stores the bytes and returns the CID the store recorded for them. */
  put(bytes: Uint8Array): Promise<string>;
}

/** Trailing slashes only, so the paths below cannot end up with `//blob` and a 404 nobody explains. */
const origin = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

export const apiBlobs = (baseUrl: string, fetchFn: typeof fetch = fetch): BlobIO => {
  const base = origin(baseUrl);

  return {
    async get(cid) {
      const response = await fetchFn(`${base}/blob/${cid}`);
      if (response.status === 404) return null;
      // The CID and the status. A body from this endpoint is ciphertext; an error body from the API is a
      // `{"error": …}` string, and neither belongs in a keeper log.
      if (!response.ok) throw new Error(`GET /blob/${cid} → HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },

    async put(bytes) {
      const response = await fetchFn(`${base}/blob`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      });
      if (!response.ok) {
        throw new Error(`POST /blob → HTTP ${response.status} (${bytes.byteLength} bytes refused)`);
      }
      const recorded = (await response.json()) as { cid?: unknown };
      if (typeof recorded.cid !== "string") throw new Error("POST /blob answered without a cid");
      const local = cidOf(bytes);
      if (recorded.cid !== local) {
        // Not a tidy-up. The CID we hand the contract is the only name the panel has for these bytes, and
        // the two sides of `cid = sha256(ciphertext)` disagreeing means one of them is not hashing what it
        // says — which is an exhibit that cannot be retrieved, found here rather than at the panel.
        throw new Error(`the store recorded ${recorded.cid} for bytes that hash to ${local}`);
      }
      return recorded.cid;
    },
  };
};
