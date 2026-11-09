// S-11.2 / Issue #140: Step 2 of PRD §8 acceptance test
// Tipster uploads invoice_fictional.pdf (hidden author "J. Okafor", creation software, an incremental-update revision) and a phone photo with GPS EXIF.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { workspaceRoot } from "../lib/env.js";
import { fail, info, ok, step } from "../lib/log.js";
import type { DemoContext } from "./types.js";

export async function step2(ctx: DemoContext): Promise<void> {
  step(2, 'Tipster prepares fictional evidence: invoice with hidden author/revisions and photo with GPS EXIF');

  const root = workspaceRoot();
  const pdfPath = join(root, "fixtures/files/invoice_fictional.pdf");
  const jpgPath = join(root, "fixtures/files/photo_gps.jpg");

  if (!existsSync(pdfPath)) {
    fail(`Required fictional fixture not found: ${pdfPath}`);
  }
  if (!existsSync(jpgPath)) {
    fail(`Required fictional fixture not found: ${jpgPath}`);
  }

  const pdfBuf = readFileSync(pdfPath);
  const jpgBuf = readFileSync(jpgPath);

  info(`Read invoice fixture: ${pdfPath} (${pdfBuf.length} bytes)`);
  info(`Read photo fixture:   ${jpgPath} (${jpgBuf.length} bytes)`);

  // Assert invoice contains uncleaned metadata / revisions (e.g. /Prev incremental update or Author)
  const pdfString = pdfBuf.toString("latin1");
  const hasRevision = pdfString.includes("/Prev") || pdfString.includes("Author") || pdfString.includes("Okafor");
  assert.equal(hasRevision, true, "invoice_fictional.pdf must contain uncleaned metadata or incremental revisions");

  // Assert JPEG contains EXIF marker (0xFF, 0xE1)
  const hasExif = jpgBuf[0] === 0xff && jpgBuf[1] === 0xd8 && jpgBuf[2] === 0xff && jpgBuf[3] === 0xe1;
  assert.equal(hasExif, true, "photo_gps.jpg must contain EXIF metadata APP1 segment");

  ctx.rawFiles = [
    { name: "invoice_fictional.pdf", mime: "application/pdf", raw: pdfBuf },
    { name: "photo_gps.jpg", mime: "image/jpeg", raw: jpgBuf },
  ];

  assert.equal(ctx.rawFiles.length, 2, "Must have exactly 2 raw evidence files prepared");
  ok('Fictional evidence files loaded and confirmed to contain real privacy leaks before cleaning');
}
