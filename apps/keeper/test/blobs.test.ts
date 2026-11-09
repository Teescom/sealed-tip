// The keeper's half of the ciphertext store (S-9.3). Everything here is checked against a fake `fetch`:
// what matters is the three ways this could go wrong quietly — a 404 read as an empty blob, a refusal that
// quotes the bytes it refused, and a CID that does not match the box it names.
import assert from "node:assert/strict";
import { test } from "node:test";

import { cidOf } from "@sealedtip/crypto";

import { apiBlobs } from "../src/blobs.js";

interface Sent {
  url: string;
  init: RequestInit;
}

const harness = (reply: (sent: Sent) => Response): { sent: Sent[]; blobs: ReturnType<typeof apiBlobs> } => {
  const sent: Sent[] = [];
  const blobs = apiBlobs("https://api.test/", async (url, init) => {
    const record = { url: String(url), init: (init ?? {}) as RequestInit };
    sent.push(record);
    return reply(record);
  });
  return { sent, blobs };
};

const bytes = new Uint8Array([1, 2, 3, 4]);
const HEX_CID = cidOf(bytes);

test("a stored box comes back as exactly the bytes it was stored as", async () => {
  const { sent, blobs } = harness(() => new Response(bytes));
  assert.deepEqual(Array.from((await blobs.get(HEX_CID)) ?? new Uint8Array()), Array.from(bytes));
  assert.equal(sent[0]?.url, "https://api.test/blob/" + HEX_CID, "the trailing slash in the base made a double path");
});

test("a 404 is `null`, not an empty blob and not a thrown error", async () => {
  const { blobs } = harness(() => new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
  assert.equal(await blobs.get(HEX_CID), null);
});

test("any other status is an upstream failure that repeats no part of the body", async () => {
  const { blobs } = harness(() => new Response("SECRET UPSTREAM TEXT", { status: 500 }));
  const error = await blobs.get(HEX_CID).then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.ok(error instanceof Error);
  assert.equal(error.message, `GET /blob/${HEX_CID} → HTTP 500`);
});

test("an upload is a raw octet body and returns the CID the store recorded", async () => {
  const { sent, blobs } = harness(() => new Response(JSON.stringify({ cid: HEX_CID, bytes: 4 }), { status: 201 }));
  assert.equal(await blobs.put(bytes), HEX_CID);
  assert.equal(sent[0]?.url, "https://api.test/blob");
  assert.equal(sent[0]?.init.method, "POST");
  assert.equal((sent[0]?.init.headers as Record<string, string>)?.["content-type"], "application/octet-stream");
  assert.deepEqual(Array.from(sent[0]?.init.body as Uint8Array), Array.from(bytes), "the body was re-encoded");
});

test("a store that hashes differently is refused rather than pointed at", async () => {
  const { blobs } = harness(() => new Response(JSON.stringify({ cid: "00".repeat(32) }), { status: 201 }));
  const error = await blobs.put(bytes).then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.ok(error instanceof Error);
  // Both are hashes of ciphertext — public by construction — and the mismatch is the whole diagnosis.
  assert.match(error.message, new RegExp(`recorded ${"00".repeat(32)} for bytes that hash to ${HEX_CID}`));
});

test("an upload answer with no cid is a failure, not an undefined pointer", async () => {
  for (const body of ["{}", '{"bytes":4}', "not json"]) {
    const { blobs } = harness(() => new Response(body, { status: 201 }));
    const error = await blobs.put(bytes).then(
      () => undefined,
      (e: unknown) => e,
    );
    assert.ok(error instanceof Error, `${body} was accepted as an upload`);
  }
});

test("a 413 refusal is reported with the size and never with the content", async () => {
  const oversized = new Uint8Array(1024).fill(7);
  const { blobs } = harness(() => new Response(JSON.stringify({ error: "body over the cap" }), { status: 413 }));
  const error = await blobs.put(oversized).then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.ok(error instanceof Error);
  assert.equal(error.message, "POST /blob → HTTP 413 (1024 bytes refused)");
});
