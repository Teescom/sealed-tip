// The cleaning report (S-6.11). Two things have to be true of it: it tells the tipster what came off
// their file, and it says it in tag names and counts only — the one object that describes what was
// private must not itself be private, because its hash goes on-chain and it travels inside the bundle.
//
// The third thing this file tests is the one that makes the others worth having: `describeFile` re-opens
// the cleaned file and refuses to write a report about a removal it cannot see, so the last test here is
// handing it a cleaned file that was never cleaned.
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReport, cleanFile, describeFile, type ReportInput } from "../src/index.js";

import { FICTIONAL_VALUES, fixtureBlob } from "./inspect.js";
import { nodeHost } from "./node_host.js";

const clean = async (name: string, scanMode = false): Promise<ReportInput> => {
  const host = nodeHost();
  const original = await fixtureBlob(name);
  const { cleaned, cleanedType } = await cleanFile(original, host, { scanMode });
  return { name, type: cleanedType, original, cleaned, scanMode, host };
};

test("the invoice report names everything the container carried (S-6.11)", async () => {
  const input = await clean("invoice_fictional.pdf");
  const { report, warnings } = await describeFile(input);
  assert.equal(report.type, "application/pdf");
  assert.equal(report.pages, 1);
  assert.equal(report.scanMode, false);
  assert.deepEqual(report.removed, [
    "Author",
    "CreationDate",
    "Creator",
    "ModDate",
    "Producer",
    "Title",
    "dc:creator",
    "dc:title",
    "document history (2 saved versions)",
    "selectable text",
    "xmp:CreatorTool",
    "xmp:MetadataDate",
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /held 2 saved versions/);
});

test("the photo report lists tags, and the scan report keeps the geometry out of it (S-6.11)", async () => {
  const photo = await describeFile(await clean("photo_gps.jpg"));
  assert.deepEqual(photo.report.removed, [
    "Artist",
    "GPSAltitude",
    "GPSAltitudeRef",
    "GPSLatitude",
    "GPSLatitudeRef",
    "GPSLongitude",
    "GPSLongitudeRef",
    "GPSMapDatum",
    "Make",
    "Model",
    "ModifyDate",
    "Software",
    "latitude",
    "longitude",
  ]);
  assert.equal(photo.report.pages, undefined, "a photograph does not have pages");
  assert.deepEqual(photo.warnings, []);

  // The PNG's own chunk facts (width, height, bit depth) are still true of the cleaned file, so they are
  // not things that were removed — and the tags the eXIf chunk smuggled in are.
  const scan = await describeFile(await clean("scan_with_dots.png"));
  assert.ok(scan.report.removed.includes("GPSLatitude"));
  assert.ok(!scan.report.removed.includes("ImageWidth"));
});

test("scan mode reports the colour it took off (S-6.11)", async () => {
  const { report } = await describeFile(await clean("scan_with_dots.png", true));
  assert.ok(report.removed.includes("colour (grayscale)"));
  assert.equal(report.scanMode, true);
});

test("no report field repeats a value from the document (S-6.11, privacy invariant 4)", async () => {
  const report = await buildReport([
    await clean("invoice_fictional.pdf"),
    await clean("photo_gps.jpg"),
    await clean("scan_with_dots.png", true),
  ]);
  const json = JSON.stringify(report);
  for (const value of FICTIONAL_VALUES) assert.ok(!json.includes(value), `the report leaked ${value}`);
  assert.equal(report.files.length, 3);
  // One warning per sentence, however many files needed it.
  assert.deepEqual(report.warnings, [
    "This file held 2 saved versions of itself. Older versions of a PDF stay in the file, including the metadata the current version no longer shows.",
    "Scan mode makes printer tracking dots hard to see; it is a mitigation, not a guarantee.",
  ]);
});

test("a cleaner that did nothing cannot file a report (S-6.11)", async () => {
  for (const name of ["invoice_fictional.pdf", "photo_gps.jpg", "scan_with_dots.png"] as const) {
    const original = await fixtureBlob(name);
    const type = name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".png") ? "image/png" : "image/jpeg";
    // The same bytes on both sides: a report written from this would say "removed: Author" about a file
    // that still has it — and for the PDF it is exactly the case of a cleaner that kept the older
    // revision, which is the one a viewer cannot see.
    await assert.rejects(
      () => describeFile({ name, type, original, cleaned: original, scanMode: false, host: nodeHost() }),
      (error: Error) => {
        assert.equal(error.name, "CleaningFailed", `${name} was accepted as its own cleaned copy`);
        return true;
      },
    );
  }
});
