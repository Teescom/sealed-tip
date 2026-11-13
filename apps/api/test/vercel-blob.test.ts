// The Vercel Blob adapter's only two rules are naming and round-trip: the cid is the pathname, so a store
// that returns the bytes for that cid has stored the exhibit the contract recorded, and a missing cid is
// null, not a crash. The SDK is faked through the two-method `BlobClient` seam, so no bucket is needed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { vercelBlobStore, type BlobClient } from "../src/store/vercel-blob.js";

const fakeClient = (): BlobClient & { stored(): Map<string, Uint8Array> } => {
  const map = new Map<string, Uint8Array>();
  return {
    put: async (pathname, body) => {
      map.set(pathname, body);
    },
    get: async (pathname) => map.get(pathname) ?? null,
    stored: () => map,
  };
};

test("put stores the ciphertext under its own sha256, so cid is both key and name", async () => {
  const client = fakeClient();
  const store = vercelBlobStore(1024, client);

  const bytes = new Uint8Array([1, 2, 3, 4]);
  const cid = await store.put(bytes);
  assert.equal(cid.length, 64);
  assert.ok(client.stored().has(cid), "the blob was not stored under its cid");
  assert.deepEqual(await store.get(cid), bytes);
});

test("a cid with no blob answers null, which the route turns into a 404", async () => {
  const store = vercelBlobStore(1024, fakeClient());
  assert.equal(await store.get("a".repeat(64)), null);
});
