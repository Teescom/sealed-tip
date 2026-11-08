// The bundle envelope and the sealed keys (S-6.5). These are the bytes a tipster's privacy rests on:
// one public ciphertext, and K reachable only inside a sealed box addressed to one recipient.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { HexCid } from "@sealedtip/core";

import {
  cidOf,
  decryptBundle,
  deriveKeys,
  encryptBundle,
  newSecret,
  openSealed,
  sealTo,
} from "../src/index.js";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const asArray = (value: Uint8Array): number[] => Array.from(value);

test("a bundle round-trips, and the ciphertext is not the plaintext", async () => {
  const plaintext = text("invoice 4471 — the client never paid");
  const { key, ciphertext } = await encryptBundle(plaintext);
  assert.equal(key.length, 32);
  assert.notDeepEqual(asArray(ciphertext), asArray(plaintext));
  assert.deepEqual(asArray(await decryptBundle(key, ciphertext)), asArray(plaintext));
});

test("the same bundle encrypts to different bytes every time", async () => {
  const plaintext = text("same file, twice");
  const a = await encryptBundle(plaintext);
  const b = await encryptBundle(plaintext);
  assert.notEqual(cidOf(a.ciphertext), cidOf(b.ciphertext), "a fixed nonce would make this a duplicate");
  assert.notDeepEqual(asArray(a.key), asArray(b.key), "the key is random too, not derived from the file");
  assert.deepEqual(asArray(await decryptBundle(b.key, b.ciphertext)), asArray(plaintext));
});

test("a flipped ciphertext byte is refused, not silently mis-decoded", async () => {
  const { key, ciphertext } = await encryptBundle(text("invoice"));
  const tampered = ciphertext.slice();
  const last = tampered.length - 1;
  tampered[last] = (tampered[last] ?? 0) ^ 0x01;
  await assert.rejects(() => decryptBundle(key, tampered));
  await assert.rejects(() => decryptBundle(key, ciphertext.subarray(0, 30)), /too short/);
  await assert.rejects(() => decryptBundle(new Uint8Array(31), ciphertext), /32 bytes/);
});

test("K reaches the tipster through a sealed box on the keys their words derive", async () => {
  const tipster = await deriveKeys(newSecret());
  const bundle = await encryptBundle(text("the bundle"));
  const sealed = await sealTo(bundle.key, tipster.x25519.publicKey);
  assert.equal(sealed.length, bundle.key.length + 48, "a sealed box is ephemeral pk ‖ tag ‖ box");
  assert.deepEqual(
    asArray(await openSealed(sealed, tipster.x25519.publicKey, tipster.x25519.secretKey)),
    asArray(bundle.key),
  );

  // The recipient's *public* key alone is not enough, and another tipster's secret is not either.
  const stranger = await deriveKeys(newSecret());
  await assert.rejects(() => openSealed(sealed, stranger.x25519.publicKey, stranger.x25519.secretKey));
  await assert.rejects(
    () => openSealed(sealed.subarray(0, 20), tipster.x25519.publicKey, tipster.x25519.secretKey),
    /shorter than a sealed box can be/,
  );
});

test("the cid is sha256 of the ciphertext, in the shape the contract stores", async () => {
  const plaintext = text("bundle for hashing");
  const { ciphertext } = await encryptBundle(plaintext);
  const cid = cidOf(ciphertext);
  assert.equal(cid, createHash("sha256").update(ciphertext).digest("hex"));
  assert.match(cid, /^[0-9a-f]{64}$/);
  // `HexCid.parse` rather than a `doesNotThrow`: it returns the value, so a schema that widened to
  // `string` would still be caught by the assertion above it — but this one is the shape contract.
  assert.equal(HexCid.parse(cid), cid);
  assert.notEqual(cid, createHash("sha256").update(plaintext).digest("hex"), "a cid of plaintext would leak it");
});
