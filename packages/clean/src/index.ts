// The pipeline in one call: gate, then clean, then optionally scan (S-6.7–S-6.11).
//
// `apps/web` (P10) calls this and nothing else. The split underneath it is there because a PDF and a
// photograph lose their secrets in different ways — one is rasterised page by page and rebuilt, the other
// is decoded to pixels and re-encoded — but the tipster's decision is one question: do you want the
// photocopier version too, which also fights printer tracking dots and costs you the colour.
export * from "./gate.js";
export * from "./host.js";
export * from "./image.js";
export * from "./pdf.js";
export * from "./report.js";
export * from "./scan.js";

import { blobOf, readBlob, type CanvasHost, type CleanPage } from "./host.js";
import { reencodeBytes } from "./image.js";
import { pdfPages, rebuildPdf } from "./pdf.js";
import { RefusedType, sniffType, type Supported } from "./gate.js";
import { scanBytes, type ScanOptions } from "./scan.js";

export interface CleanOptions extends ScanOptions {
  dpi?: number;
  quality?: number;
  /** Photocopier mode: grayscale and threshold, which is what makes a tracking-dot grid hard to see. */
  scanMode?: boolean;
}

export interface CleanedFile {
  cleaned: Blob;
  /** The MIME type of what came out, which is the honest one: scan mode turns a JPEG into a PNG. */
  cleanedType: Supported;
}

export const cleanFile = async (file: Blob, host: CanvasHost, opts: CleanOptions = {}): Promise<CleanedFile> => {
  const type = await sniffType(file);
  if (type === "refused") throw new RefusedType();
  if (type === "application/pdf") {
    const pages = await pdfPages(file, host, opts);
    const sheets: CleanPage[] = [];
    for (const page of pages) {
      sheets.push(
        opts.scanMode
          ? { ...page, image: await scanBytes(page.image, host, opts), kind: "png" }
          : page,
      );
    }
    return { cleaned: await rebuildPdf(sheets), cleanedType: "application/pdf" };
  }
  const bytes = await readBlob(file);
  if (opts.scanMode) {
    return { cleaned: blobOf(await scanBytes(bytes, host, opts), "image/png"), cleanedType: "image/png" };
  }
  const { image, kind } = await reencodeBytes(bytes, host, opts);
  return { cleaned: blobOf(image, kind === "jpg" ? "image/jpeg" : "image/png"), cleanedType: type };
};
