// The type gate (S-6.7). Everything a tipster uploads passes through these eight bytes, and what it does
// not pass through is the point: a format this package cannot rasterise is a format it must not open.
import assert from "node:assert/strict";
import { test } from "node:test";

import { REFUSAL_MESSAGE, RefusedType, SUPPORTED, cleanFile, sniffType } from "../src/index.js";

import { fixtureBlob, fixtureBytes } from "./inspect.js";
import { nodeHost } from "./node_host.js";

const pdf = () => fixtureBytes("invoice_fictional.pdf");
const jpeg = () => fixtureBytes("photo_gps.jpg");
const png = () => fixtureBytes("scan_with_dots.png");
const docx = () => fixtureBytes("memo.docx");

test("the three supported types are sniffed out of their own bytes (S-6.7)", async () => {
  assert.equal(await sniffType(new Blob([await pdf()])), "application/pdf");
  assert.equal(await sniffType(new Blob([await jpeg()])), "image/jpeg");
  assert.equal(await sniffType(new Blob([await png()])), "image/png");
  assert.deepEqual([...SUPPORTED], ["application/pdf", "image/jpeg", "image/png"]);
});

test("the docx fixture is refused (S-6.7)", async () => {
  const bytes = await docx();
  assert.equal(bytes[0], 0x50, "a docx is a zip: P K 03 04");
  assert.equal(await sniffType(new Blob([bytes])), "refused");
});

test("a filename and a MIME type are not evidence (S-6.7)", async () => {
  // The worst case in the product is an operating system that lies, or a tipster who renames a word
  // document to .pdf because the upload box asked for a PDF.
  assert.equal(await sniffType(new Blob([await pdf()], { type: "image/jpeg" })), "application/pdf");
  assert.equal(await sniffType(new Blob([await docx()], { type: "application/pdf" })), "refused");
  assert.equal(await sniffType(new Blob([await docx()], { type: "image/png" })), "refused");
});

test("near misses are refused, not approximated (S-6.7)", async () => {
  const gif = new Uint8Array([...new TextEncoder().encode("GIF89a"), 0, 0, 0, 0]);
  const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
  // A real HEIC box header: four size bytes, then `ftyp`, then the brand. It is the format a phone
  // camera writes and the one this package would have to say no to in the tipster's own file picker.
  const heic = new Uint8Array([0x00, 0x00, 0x00, 0x18, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);
  assert.equal(await sniffType(new Blob([gif])), "refused");
  assert.equal(await sniffType(new Blob([tiff])), "refused");
  assert.equal(await sniffType(new Blob([heic])), "refused");
  // A truncated PNG header: the four bytes everybody recognises, and the four that make it a PNG.
  assert.equal(await sniffType(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00])])), "refused");
  assert.equal(await sniffType(new Blob([new Uint8Array(0)])), "refused");
});

test("a refused file never reaches a cleaner (S-6.7, privacy invariant 4)", async () => {
  const host = nodeHost();
  const memo = await fixtureBlob("memo.docx");
  await assert.rejects(() => cleanFile(memo, host), (error: Error) => {
    assert.ok(error instanceof RefusedType, `cleanFile threw ${error.name} for a docx`);
    assert.equal(error.message, REFUSAL_MESSAGE, "the UI shows this text verbatim");
    return true;
  });
});
