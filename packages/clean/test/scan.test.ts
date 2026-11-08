// Scan mode (S-6.10): the yellow-dot grid in the scan fixture is what a dot-code printer stamp looks
// like at this resolution, and the ledger text in the same band is what has to survive it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanFile, pdfPages, scanMode, sniffType } from "../src/index.js";

import { fixtureBlob, fixtureBytes, tallyPixels } from "./inspect.js";
import { nodeHost } from "./node_host.js";

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

test("the dot grid disappears and the text stays (S-6.10)", async () => {
  const host = nodeHost();
  const original = await fixtureBlob("scan_with_dots.png");
  const cleaned = await scanMode(original, host);
  assert.equal(await sniffType(cleaned), "image/png", "a bilevel page deserves a lossless container");

  const before = await tallyPixels(await fixtureBytes("scan_with_dots.png"));
  const after = await tallyPixels(await bytesOf(cleaned));
  assert.ok(before.dots > 1000, `the fixture has ${before.dots} dot pixels: it is not a dot fixture any more`);
  assert.equal(after.dots, 0, "the dot grid survived scan mode");
  assert.ok(after.ink > before.ink * 0.6, `the ink went from ${before.ink} to ${after.ink}`);
});

test("what comes out is bilevel, whatever went in (S-6.10)", async () => {
  const host = nodeHost();
  const cleaned = await scanMode(await fixtureBlob("photo_gps.jpg"), host);
  const surface = await host.decode(await bytesOf(cleaned));
  const bytes = await surface.read();
  const shades = new Set<number>();
  for (let i = 0; i < bytes.length; i += 4) {
    shades.add(bytes[i]!);
    shades.add(bytes[i + 1]!);
    shades.add(bytes[i + 2]!);
    assert.equal(bytes[i + 3], 255, "scan mode left a transparent pixel behind");
  }
  assert.deepEqual([...shades].sort((a, b) => a - b), [0, 255], "the output is not black and white");
});

test("the threshold is the knob it claims to be (S-6.10)", async () => {
  const host = nodeHost();
  const original = await fixtureBytes("scan_with_dots.png");
  // Everything above zero luma becomes paper: the page goes blank, which is the only honest proof that
  // the threshold is what decides the output rather than something downstream of it.
  const blank = await scanMode(new Blob([original]), host, { threshold: 0 });
  const tally = await tallyPixels(await bytesOf(blank));
  assert.equal(tally.ink, 0);
  assert.equal(tally.dots, 0);
  await assert.rejects(() => scanMode(new Blob([original]), host, { threshold: 300 }), RangeError);
});

test("a PDF asked for scan mode is photocopied, then photocopied harder (S-6.10, S-6.8)", async () => {
  const host = nodeHost();
  const { cleaned, cleanedType } = await cleanFile(await fixtureBlob("invoice_fictional.pdf"), host, {
    scanMode: true,
  });
  assert.equal(cleanedType, "application/pdf");
  const page = await pdfPages(cleaned, host);
  const tally = await tallyPixels(page[0]!.image);
  assert.equal(tally.dots, 0);
  assert.ok(tally.ink > 1000, `the thresholded page has ${tally.ink} ink pixels: the text did not survive`);
});
