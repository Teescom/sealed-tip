// The blob store: ciphertext in, cid out (ARCHITECTURE §2 Storage, §9). `cid = sha256(ciphertext)` and a
// 25 MB cap are the whole contract, and neither is negotiable by the caller — so both are enforced here,
// in the one place that touches the bytes.
import { createHash } from "node:crypto";

/** 25 MB, the per-tip cap ARCHITECTURE §2 states. `.env`'s BLOB_MAX_BYTES overrides it per deployment. */
export const BLOB_MAX_BYTES = 26_214_400;

export interface BlobStore {
  readonly maxBytes: number;
  /** Stores the bytes under their own hash and returns that cid. */
  put(bytes: Uint8Array): Promise<string>;
  get(cid: string): Promise<Uint8Array | null>;
}

/** The same rule `packages/crypto`'s `cidOf` implements for the client, over the same bytes: what the
 * panel is shown has to hash to what the contract stored, or the exhibit is not the one that was tipped. */
export const cidOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Carries the size that was actually received, so a 413 can say by how much it was over without
 * echoing any of it. */
export class TooLarge extends Error {
  constructor(readonly received: number) {
    super(`body of ${received} bytes over the cap`);
    this.name = "TooLarge";
  }
}

/**
 * Reads a request body with a cap that does not trust `Content-Length`: an attacker who declares 1 KB and
 * sends 400 MB has won if the server allocates on the declaration. Bytes are counted as they arrive and
 * the stream is cancelled the moment the cap is passed, so an oversized upload costs the store nothing.
 */
export const readCapped = async (
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> => {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new TooLarge(total);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

/**
 * The four containers this project's own cleaners know (`packages/clean`'s gate): a blob that begins with
 * one of them is a document that reached the server unsealed. The client is the one that encrypts, so
 * this cannot be a *proof*, and it is not meant to be one — it is the backstop that turns a client bug
 * into a refused upload instead of of a plaintext exhibit sitting in the store under a real hash.
 */
const CONTAINERS: readonly { readonly name: string; readonly magic: readonly number[] }[] = [
  { name: "PDF", magic: [0x25, 0x50, 0x44, 0x46] },
  { name: "JPEG", magic: [0xff, 0xd8, 0xff] },
  { name: "PNG", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: "ZIP container (docx, xlsx)", magic: [0x50, 0x4b, 0x03, 0x04] },
];

export const plaintextContainer = (bytes: Uint8Array): string | null => {
  for (const { name, magic } of CONTAINERS) {
    if (magic.every((byte, index) => bytes[index] === byte)) return name;
  }
  return null;
};

/**
 * The in-process store the demo and the tests run on. ARCHITECTURE §2 names Vercel Blob or an
 * S3-compatible bucket for a deployed API, and that is what `BLOB_STORE_URL` is for: the same two methods
 * over a network, so a deployment swaps this out without a route changing. Writing that adapter blind,
 * against a store nobody here has credentials for, would be an untested thing presented as a finished
 * one, so this is the only implementation until a deployment is actually configured.
 */
export const memoryBlobStore = (
  maxBytes = BLOB_MAX_BYTES,
): BlobStore & { readonly size: number } => {
  const blobs = new Map<string, Uint8Array>();
  return {
    maxBytes,
    get size(): number {
      return blobs.size;
    },
    put: async (bytes: Uint8Array): Promise<string> => {
      if (bytes.byteLength > maxBytes) throw new TooLarge(bytes.byteLength);
      const cid = cidOf(bytes);
      // Two tips carrying identical ciphertext share one entry: the cid is the key, so this is a property
      // of the hashing, not a cache that could be wrong.
      blobs.set(cid, bytes.slice());
      return cid;
    },
    get: async (cid: string): Promise<Uint8Array | null> => blobs.get(cid)?.slice() ?? null,
  };
};
