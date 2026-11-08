// S-8.3: the blob store holds ciphertext, keyed by its own hash, under a cap the caller does not set.
// Three properties matter and each gets checked against the route a tipster's browser actually calls:
// the cid is sha256 of the bytes (so `packages/crypto`'s client-side `cidOf` and the contract's
// `evidence_cid` can never disagree), the cap is enforced on the bytes that arrive rather than the
// length that is declared, and nothing about a refused upload comes back.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { blobRoutes } from "../src/routes/blob.js";
import {
  BLOB_MAX_BYTES,
  TooLarge,
  cidOf,
  memoryBlobStore,
  plaintextContainer,
  readCapped,
  type BlobStore,
} from "../src/store/blob.js";

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Ciphertext looks like noise, so the fixtures here are noise: a store must not need to know the plaintext. */
const cipher = (length: number, seed = 1): Uint8Array => {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = state >>> 16;
  }
  return bytes;
};

const api = (maxBytes = 4096): { app: ReturnType<typeof blobRoutes>; store: ReturnType<typeof memoryBlobStore> } => {
  const store = memoryBlobStore(maxBytes);
  return { app: blobRoutes(store), store };
};

/** A real upload is bytes or a stream; the union is what `fetch` accepts, minus the parts that would hide the cap. */
const post = (app: ReturnType<typeof blobRoutes>, body: Uint8Array | ReadableStream<Uint8Array> | null) =>
  app.request("/", { method: "POST", body });

test("the cid a tipster is handed is sha256 of the bytes that got stored", async () => {
  const { app, store } = api();
  const bytes = cipher(2048);
  const res = await post(app, bytes);
  assert.equal(res.status, 201);
  const body = (await res.json()) as { cid: string; bytes: number };
  assert.equal(body.bytes, 2048);
  assert.equal(body.cid, sha256Hex(bytes), "the cid is a hash of the ciphertext, computed independently here");
  assert.equal(body.cid, cidOf(bytes), "the route and the store must agree on one rule");
  assert.deepEqual(await store.get(body.cid), bytes);
});

test("a stored blob comes back through GET byte for byte, as opaque bytes", async () => {
  const { app } = api();
  const bytes = cipher(1000, 9);
  const { cid } = (await (await post(app, bytes)).json()) as { cid: string };
  const res = await app.request(`/${cid}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/octet-stream");
  assert.equal(res.headers.get("content-length"), "1000");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
});

test("a cid that is not 64 lowercase hex never reaches the store", async () => {
  // What the property actually is: the store is a lookup keyed by a hash the contract can re-check, so a
  // request that is not that shape must be answered without asking it anything. A path that does not even
  // line up with one segment (`../../etc/passwd`) is refused by the router as 404, which is the same
  // outcome, and both are asserted here rather than one status code being guessed at.
  const asked: string[] = [];
  const spy: BlobStore = {
    maxBytes: 4096,
    put: async () => "",
    get: async (cid) => {
      asked.push(cid);
      return null;
    },
  };
  const app = blobRoutes(spy);
  const cases = [
    "nope",
    "a".repeat(63),
    "a".repeat(65),
    "f".repeat(64).replace("f", "g"),
    "A".repeat(64),
    "0".repeat(63) + "Z",
    "x".repeat(64),
    "../../etc/passwd",
  ];
  for (const cid of cases) {
    const res = await app.request(`/${cid}`);
    assert.ok(res.status === 400 || res.status === 404, `${cid} got ${res.status}: ${await res.text()}`);
  }
  assert.deepEqual(asked, [], `the store was queried with a malformed cid: ${asked.join(", ")}`);
  // And it does get consulted for a well-formed cid that simply is not there — which is the 404 the next
  // test checks — so the empty list above is the guard working, not the route never running.
  await app.request("/" + "0".repeat(64));
  assert.deepEqual(asked, ["0".repeat(64)]);
});

test("an unknown cid is 404, and the response says nothing about what the store holds", async () => {
  const { app } = api();
  const absent = "0".repeat(64);
  const missing = await app.request(`/${absent}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "not found" });
});

test("one blob at the cap is stored; one byte more is refused", async () => {
  const { app, store } = api(1024);
  assert.equal((await post(app, cipher(1024))).status, 201);
  assert.equal(store.size, 1);
  const over = await post(app, cipher(1025));
  assert.equal(over.status, 413);
  assert.equal(store.size, 1, "the oversized upload left nothing in the store");
  const detail = ((await over.json()) as { error: string }).error;
  assert.match(detail, /1025/);
  assert.match(detail, /1024/);
});

test("the cap counts the bytes that arrive, not the Content-Length that is declared", async () => {
  const { app, store } = api(256);
  // A lie a server must not believe: 24 bytes declared, 4 KB streamed. Anything that allocated on the
  // header would have handed the caller a 4 KB buffer for a "24 byte" upload.
  const request = new Request("http://localhost/", {
    method: "POST",
    duplex: "half",
    headers: { "content-length": "24" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 16; i++) controller.enqueue(cipher(256, i + 1));
        controller.close();
      },
    }),
  });
  const res = await app.fetch(request);
  assert.equal(res.status, 413);
  assert.equal(store.size, 0);
  const text = await res.text();
  // 2 two-chunk reads of 256 got counted, so the refusal reports 512 streamed bytes. If the server had
  // believed the header it would have buffered forever, or reported 24.
  assert.match(text, /512 bytes/);
  assert.ok(!text.includes("24 "), `the declared length was trusted: ${text}`);
});

test("a body that starts with a document container is refused as plaintext", async () => {
  const { app, store } = api();
  const containers: [string, number[]][] = [
    ["PDF", [0x25, 0x50, 0x44, 0x46]],
    ["JPEG", [0xff, 0xd8, 0xff]],
    ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["ZIP", [0x50, 0x4b, 0x03, 0x04]],
  ];
  for (const [name, magic] of containers) {
    const bytes = new Uint8Array(64);
    bytes.set(magic);
    const res = await post(app, bytes);
    assert.equal(res.status, 415, `${name} was accepted into a ciphertext-only store`);
    assert.match(((await res.json()) as { error: string }).error, new RegExp(name));
  }
  assert.equal(store.size, 0);
  assert.equal((await post(app, cipher(64, 42))).status, 201, "noise is what this store is for");
});

test("an empty upload is refused rather than stored under the hash of nothing", async () => {
  const { app, store } = api();
  const res = await post(app, new Uint8Array(0));
  assert.equal(res.status, 400);
  assert.equal(store.size, 0);
  // The hash of the empty string is a real, guessable cid; storing it would give every tip the same cid.
  assert.equal(await store.get(sha256Hex(new Uint8Array(0))), null);
});

test("two tips carrying identical ciphertext share one entry, because the cid is the key", async () => {
  const { app, store } = api();
  const bytes = cipher(512, 7);
  const first = (await (await post(app, bytes)).json()) as { cid: string };
  const second = (await (await post(app, bytes)).json()) as { cid: string };
  assert.equal(first.cid, second.cid);
  assert.equal(store.size, 1);
});

test("the store hands out copies, so a route cannot rewrite an exhibit in place", async () => {
  const store = memoryBlobStore(1024);
  const bytes = cipher(128, 3);
  const cid = await store.put(bytes);
  const first = await store.get(cid);
  assert.ok(first !== null);
  first.fill(0);
  assert.deepEqual(await store.get(cid), bytes, "the copy that was handed out is not the stored one");
  assert.notEqual(await store.get(cid), bytes, "and every read is a fresh copy");
  const written = await store.put(bytes);
  assert.equal(written, cid);
  const untouched = await store.get(cid);
  bytes.fill(0);
  assert.deepEqual(await store.get(cid), untouched, "put must not keep the caller's buffer either");
});

test("the store enforces its own cap even for a caller that bypasses the route", async () => {
  const store = memoryBlobStore(16);
  await assert.rejects(() => store.put(cipher(17)), TooLarge);
  assert.equal(store.maxBytes, 16);
  assert.equal(store.size, 0);
});

test("readCapped: null body is empty, a 0 cap refuses anything, and the default cap is 25 MB", async () => {
  assert.deepEqual(await readCapped(null, 10), new Uint8Array(0));
  await assert.rejects(
    () =>
      readCapped(
        new Response(cipher(1)).body,
        0,
      ),
    (error: unknown) => error instanceof TooLarge && error.received === 1,
  );
  assert.equal(BLOB_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(memoryBlobStore().maxBytes, BLOB_MAX_BYTES);
});

test("plaintextContainer only looks at the header, so a truncated or shifted document still passes", () => {
  assert.equal(plaintextContainer(new Uint8Array(0)), null);
  assert.equal(plaintextContainer(new Uint8Array([0x25, 0x50])), null, "two bytes is not a PDF signature");
  assert.equal(plaintextContainer(new Uint8Array([0x00, 0x25, 0x50, 0x44, 0x46])), null, "one byte of offset");
  assert.equal(plaintextContainer(new Uint8Array([0x25, 0x50, 0x44, 0x46])), "PDF");
});
