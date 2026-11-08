// Image cleaning (S-6.9): decode to pixels, encode a new file. The fixture phone photo carries Make,
// Model, Software, an artist name, a timestamp and a GPS position; the scan carries the same in an eXIf
// chunk inside a PNG, which is the case a tag-stripping cleaner is most likely to miss.
import assert from "node:assert/strict";
import { test } from "node:test";

import { reencodeImage, sniffType } from "../src/index.js";

import { carriesAnyFictionalValue, fixtureBlob, imageTags, tallyPixels } from "./inspect.js";
import { nodeHost } from "./node_host.js";

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

test("a re-encoded JPEG reports no tags at all (S-6.9)", async () => {
  const host = nodeHost();
  const cleaned = await reencodeImage(await fixtureBlob("photo_gps.jpg"), host);
  assert.equal(await sniffType(cleaned), "image/jpeg", "a photo stays a photo");
  assert.deepEqual(await imageTags(await bytesOf(cleaned)), [], "exifr found an EXIF block");
  assert.deepEqual(carriesAnyFictionalValue(await bytesOf(cleaned)), []);
});

test("a re-encoded PNG loses the eXIf chunk it was carrying (S-6.9)", async () => {
  const host = nodeHost();
  const cleaned = await reencodeImage(await fixtureBlob("scan_with_dots.png"), host);
  assert.equal(await sniffType(cleaned), "image/png");
  assert.deepEqual(await imageTags(await bytesOf(cleaned)), [], "the re-encoded PNG kept its eXIf tags");
  // The chunk names, not just the values: an `eXIf` chunk is a metadata container whatever is in it.
  const text = Buffer.from(await bytesOf(cleaned)).toString("latin1");
  assert.ok(!text.includes("eXIf"), "the PNG still has an eXIf chunk");
  assert.ok(!text.includes("Exif"), "the PNG still carries a JPEG-style EXIF header");
});

test("the pixels survive: same size, same amount of ink (S-6.9)", async () => {
  const host = nodeHost();
  for (const name of ["photo_gps.jpg", "scan_with_dots.png"] as const) {
    const original = await fixtureBlob(name);
    const cleaned = await reencodeImage(original, host);
    const before = await tallyPixels(new Uint8Array(await original.arrayBuffer()));
    const after = await tallyPixels(await bytesOf(cleaned));
    assert.equal(after.total, before.total, `${name}: re-encoding changed the size`);
    // JPEG quantising moves a few pixels across any threshold; it cannot move a tenth of the page.
    assert.ok(
      Math.abs(after.ink - before.ink) < before.ink * 0.1,
      `${name}: ink went from ${before.ink} to ${after.ink}`,
    );
  }
});

test("a quality the caller did not ask for is refused, not guessed (S-6.9)", async () => {
  const host = nodeHost();
  const photo = await fixtureBlob("photo_gps.jpg");
  // 85 is the scale a native encoder takes; on ours it is a mistake, and silently clamping it would
  // change the tipster's file without anyone deciding to.
  await assert.rejects(() => reencodeImage(photo, host, { quality: 85 }), RangeError);
  await assert.rejects(() => reencodeImage(photo, host, { quality: 0 }), RangeError);
});
