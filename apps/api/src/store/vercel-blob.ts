// Vercel Blob behind the same `BlobStore` interface as the in-process store (S-8.3). Ciphertext goes in
// under its own hash, so the cid is the pathname and `get(cid)` is a `head` plus a fetch of the signed
// download URL. The real client is injected through a two-method seam, so every rule here is testable
// without a bucket, and the only untested line is the SDK call itself (which is exactly what the project's
// "don't ship an adapter nobody has credentials for" rule permits: it is typed, not invented).
import { createHash } from "node:crypto";

import type { BlobStore } from "./blob.js";

/** The two Vercel Blob operations this adapter needs, kept tiny so a test can fake them in full. */
export interface BlobClient {
  /** Stores `body` at `pathname` (which must stay exact — no random suffix — because the cid is the key). */
  put(pathname: string, body: Uint8Array): Promise<void>;
  /** The bytes at `pathname`, or `null` when no blob has that pathname. */
  get(pathname: string): Promise<Uint8Array | null>;
}

/** The real client, over the SDK. This is the only place the SDK is touched. */
export const vercelBlobClient = (token: string): BlobClient => {
  // Lazy, so a build without the token never loads the SDK for the in-process demo path.
  const sdk = async () => import("@vercel/blob");
  return {
    put: async (pathname, body) => {
      const { put } = await sdk();
      // `addRandomSuffix: false` is what makes `get(pathname)` able to find it again by cid, and
      // `access: "private"` keeps ciphertext off the public URL.
      await put(pathname, Buffer.from(body), { token, access: "private", addRandomSuffix: false });
    },
    get: async (pathname) => {
      const { head, BlobNotFoundError } = await sdk();
      try {
        const meta = await head(pathname, { token });
        const response = await fetch(meta.downloadUrl);
        if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
  };
};

export const vercelBlobStore = (maxBytes: number, client: BlobClient): BlobStore => ({
  maxBytes,
  put: async (bytes) => {
    const cid = createHash("sha256").update(bytes).digest("hex");
    await client.put(cid, bytes);
    return cid;
  },
  get: async (cid) => client.get(cid),
});
