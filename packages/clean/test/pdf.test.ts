// PDF cleaning (S-6.8). The invoice fixture is dirty in two different ways, and the second is why this
// file exists: its current revision has no Author, because a save that removed it left the *older*
// revision in the same bytes. A cleaner that reads what a viewer shows would report a clean file and
// ship the name anyway.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PDFDocument } from "pdf-lib";

import { CLEAN_TOOL, openPdf, pdfPages, rasterisePdf, sniffType } from "../src/index.js";

import { carriesAnyFictionalValue, fixtureBlob, fixtureBytes, tallyPixels } from "./inspect.js";
import { nodeHost } from "./node_host.js";

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());
const revisions = (bytes: Uint8Array): number =>
  Buffer.from(bytes).toString("latin1").split("startxref").length - 1;

test("the rebuilt PDF has none of the original's metadata (S-6.8)", async () => {
  const host = nodeHost();
  const cleaned = await rasterisePdf(await fixtureBlob("invoice_fictional.pdf"), host);
  assert.equal(await sniffType(cleaned), "application/pdf");
  const bytes = await bytesOf(cleaned);
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  assert.equal(doc.getAuthor(), undefined);
  assert.equal(doc.getTitle(), undefined);
  assert.equal(doc.getSubject(), undefined);
  assert.equal(doc.getKeywords(), undefined);
  assert.equal(doc.getCreationDate(), undefined);
  assert.equal(doc.getModificationDate(), undefined);
  // The only metadata a cleaned file carries is the line that says it was cleaned.
  assert.equal(doc.getProducer(), CLEAN_TOOL);
  assert.equal(doc.getCreator(), CLEAN_TOOL);
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(!text.includes("x:xmpmeta"), "an XMP packet survived the rebuild");
  assert.ok(!text.includes("/Prev"), "the rebuild kept an older revision");
  assert.equal(revisions(bytes), 1, "a rebuilt PDF is exactly one revision");
  assert.deepEqual(carriesAnyFictionalValue(bytes), []);
});

test("the leak a viewer cannot see is the one that gets cleaned (S-6.8)", async () => {
  const original = await fixtureBytes("invoice_fictional.pdf");
  const text = Buffer.from(original).toString("latin1");
  assert.ok(text.includes("/Author"), "the fixture stopped being a case for this test");
  assert.ok(revisions(original) > 1, "the fixture needs two saved versions to prove the point");

  const host = nodeHost();
  const source = await openPdf(original, host.pdfOptions());
  const info = (await source.getMetadata()).info as Record<string, unknown>;
  await source.cleanup();
  // What a reader of the current revision sees: no author at all. Reporting this file as "nothing to
  // remove" would be the bug, and it is the bug this test exists to keep.
  assert.equal(info["Author"], undefined);

  const cleaned = await bytesOf(await rasterisePdf(new Blob([original]), host));
  assert.ok(!Buffer.from(cleaned).toString("latin1").includes("/Author"));
  assert.deepEqual(carriesAnyFictionalValue(cleaned), []);
});

test("the page becomes pixels and keeps its shape (S-6.8)", async () => {
  const host = nodeHost();
  const original = await fixtureBlob("invoice_fictional.pdf");
  const cleaned = await rasterisePdf(original, host);
  const cleanedBytes = await bytesOf(cleaned);

  const source = await openPdf(await fixtureBytes("invoice_fictional.pdf"), host.pdfOptions());
  const page = await source.getPage(1);
  const items = (await page.getTextContent()).items;
  assert.ok(items.some((item) => "str" in item && item.str.includes("Okafor")), "the fixture lost its text layer");
  const size = page.getViewport({ scale: 1 });
  await source.cleanup();

  const rebuilt = await openPdf(cleanedBytes, host.pdfOptions());
  assert.equal(rebuilt.numPages, 1);
  const rebuiltPage = await rebuilt.getPage(1);
  const rebuiltSize = rebuiltPage.getViewport({ scale: 1 });
  assert.ok(Math.abs(rebuiltSize.width - size.width) < 1, "the rebuilt page changed size");
  assert.ok(Math.abs(rebuiltSize.height - size.height) < 1);
  const after = (await rebuiltPage.getTextContent()).items;
  assert.deepEqual(
    after.map((item) => ("str" in item ? item.str.trim() : "")).filter((str) => str.length > 0),
    [],
    "the cleaned PDF still has a text layer",
  );
  await rebuilt.cleanup();

  // Same page, same ink: rasterising is allowed to lose the search index and nothing else.
  const before = await pdfPages(original, host);
  const inkBefore = await tallyPixels(before[0]!.image);
  const inkAfter = await tallyPixels((await pdfPages(new Blob([cleanedBytes]), host))[0]!.image);
  assert.equal(inkAfter.total, inkBefore.total, "rasterising at the same dpi changed the page resolution");
  assert.ok(inkAfter.ink > inkBefore.ink * 0.75, `ink went from ${inkBefore.ink} to ${inkAfter.ink}`);
});

test("the knobs that would silently make the evidence unreadable are checked (S-6.8)", async () => {
  const host = nodeHost();
  const original = await fixtureBlob("invoice_fictional.pdf");
  await assert.rejects(() => rasterisePdf(original, host, { dpi: 12 }), RangeError);
  await assert.rejects(() => rasterisePdf(original, host, { quality: 90 }), RangeError);
  const small = await pdfPages(original, host, { dpi: 72 });
  const large = await pdfPages(original, host, { dpi: 300 });
  assert.ok(small[0]!.image.length < large[0]!.image.length, "dpi does not actually change the rasterisation");
});
