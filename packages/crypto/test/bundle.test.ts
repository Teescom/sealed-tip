// What the exhibit becomes on the wire: one ciphertext, one CID, one hash the chain can commit to (S-10.4).
import assert from "node:assert/strict";
import { test } from "node:test";

import type { TipBundle } from "@sealedtip/core";

import {
  bundleBytes,
  bundleText,
  bytes32FromHex,
  fromBase64,
  openBundle,
  reportHash,
  sealBundle,
  toBase64,
} from "../src/index.js";

const bundle = (overrides: Partial<TipBundle> = {}): TipBundle => ({
  version: 1,
  title: "Road contract fraud — Fictional State",
  description: "The invoice was paid twice for the same stretch of road.",
  files: [{ name: "invoice.pdf", mime: "application/pdf", data: "aGVsbG8=" }],
  report: { files: [{ name: "invoice.pdf", type: "application/pdf", removed: ["Author"], scanMode: false }], warnings: [] },
  redaction: null,
  ...overrides,
});

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

test("the evidence hash is the cid, in bytes — and neither is a fingerprint of the content", async () => {
  const sealed = await sealBundle(bundle());
  assert.equal(sealed.cid, hex(sealed.hash), "one 32-byte identity, two encodings");
  const twice = await sealBundle(bundle());
  assert.notEqual(twice.cid, sealed.cid, "the same bundle submitted twice must not share a chain identity");
});

test("a sealed bundle opens back to the object it went in as", async () => {
  const sealed = await sealBundle(bundle());
  const opened = await openBundle(sealed.key, sealed.ciphertext);
  assert.deepEqual(opened, bundle());
});

test("a bundle opened with the wrong key is refused rather than misread", async () => {
  const a = await sealBundle(bundle());
  const b = await sealBundle(bundle({ description: "different words" }));
  assert.rejects(async () => await openBundle(b.key, a.ciphertext));
});

test("serialization is field order and undefined, so the hash is reproducible", () => {
  const written = bundleText(bundle());
  // The same values, assembled with the keys put in at a different order — what a second implementation,
  // or a `{ ...spread }` from a form, would produce.
  const rebuilt = bundleText({
    report: bundle().report,
    description: bundle().description,
    title: bundle().title,
    version: 1,
    redaction: null,
    files: bundle().files,
  });
  assert.equal(written, rebuilt, "the same values in a different key order must hash the same");
  assert.equal(bundleBytes(bundle()).length, new TextEncoder().encode(written).length);
});

test("a ciphertext byte flipped in the middle is not a bundle", async () => {
  const sealed = await sealBundle(bundle());
  const tampered = Uint8Array.from(sealed.ciphertext);
  tampered[30] = (tampered[30] ?? 0) ^ 0x01;
  assert.rejects(async () => await openBundle(sealed.key, tampered));
});

test("the report hash is 32 bytes, stable, and changes with what was removed", () => {
  const first = reportHash(bundle().report);
  assert.equal(first.length, 32);
  assert.deepEqual(Array.from(first), Array.from(reportHash(bundle().report)));
  const changed = reportHash({
    files: [{ name: "invoice.pdf", type: "application/pdf", removed: ["Author", "GPS"], scanMode: false }],
    warnings: [],
  });
  assert.notEqual(hex(first), hex(changed));
});

test("a report the tipster edited to claim less is a different hash", () => {
  // The chain commits to this, so the panel can prove the list they were shown is the list committed to.
  const stripped = reportHash({ files: [{ name: "invoice.pdf", type: "application/pdf", removed: [], scanMode: false }], warnings: [] });
  assert.notEqual(hex(stripped), hex(reportHash(bundle().report)));
});

test("a digest handed over as hex arrives as the same 32 bytes", () => {
  const digest = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1fff";
  assert.equal(hex(bytes32FromHex(digest)), digest);
  for (const bad of ["", "zz".repeat(32), digest.slice(1), `${digest}00`, digest.toUpperCase()]) {
    assert.throws(() => bytes32FromHex(bad), RangeError, `refused: ${bad}`);
  }
});

test("binary files survive base64 exactly, including bytes above 0x7f", async () => {
  const bytes = Uint8Array.from(Array.from({ length: 256 }, (_, i) => i));
  assert.deepEqual(Array.from(await fromBase64(await toBase64(bytes))), Array.from(bytes));
});
