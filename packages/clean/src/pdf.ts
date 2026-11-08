// Rasterise every page (pdfjs) → rebuild a new PDF from images (pdf-lib). Kills incremental updates,
// metadata, fonts and embedded-image EXIF (S-6.8).
//
// A PDF is a container, and almost anything can be in one: an invisible text layer that a search engine
// reads (which is how "Prepared by: J. Okafor" ends up in a file the tipster believes they redacted),
// fonts pulled out of their machine, an XMP block with the whole editing history, embedded files,
// annotations nobody sees, and — because PDF saves append — the previous versions of the document, still
// readable, still in the same file. Every one of those is a thing the tipster cannot check. A page of
// pixels is not: what you see in the panel is what was in the file, and rebuilding the container from
// scratch is what makes the rest of it *structurally* impossible rather than forgotten.
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import { blobOf, checkQuality, JPEG_QUALITY, RASTER_DPI, readBlob, type CanvasHost, type CleanPage } from "./host.js";

/** pdfjs's own render parameter type, reached through the page proxy rather than a name it does not export. */
type RenderParameters = Parameters<PDFPageProxy["render"]>[0];

/** Written into the output's Producer/Creator, so a cleaned file says who cleaned it and nothing about who made it. */
export const CLEAN_TOOL = "sealed-tip clean client";

/**
 * pdfjs options this package insists on, whatever the host. XFA is a scriptable form layer that puts a
 * second document inside the first, and evidence this product cleans is never an XFA form: rendering only
 * what the page shows is the whole point of rasterising it.
 */
const POLICY_OPTIONS = { enableXfa: false } as const;

/** Open a PDF for reading. The bytes are copied: pdfjs hands its buffer on and must not take ours with it. */
export const openPdf = async (
  bytes: Uint8Array,
  hostOptions: Record<string, unknown> = {},
): Promise<PDFDocumentProxy> =>
  // A copy, and a plain one: pdfjs refuses a Node Buffer outright, and a Blob-backed view can share a
  // buffer with something else, which is not a thing to hand to a parser that may keep it.
  getDocument({ data: new Uint8Array(bytes), ...hostOptions, ...POLICY_OPTIONS }).promise;

export interface PdfOptions {
  /** Rasterisation density. Lower is smaller and blurrier; 150 reads like a photocopy. */
  dpi?: number;
  /** JPEG quality for each page image, 0..1. */
  quality?: number;
}

/** Render every page to pixels. Split out so scan mode can transform pages without decoding the PDF twice. */
export const pdfPages = async (
  file: Blob,
  host: CanvasHost,
  opts: PdfOptions = {},
): Promise<CleanPage[]> => {
  const dpi = opts.dpi ?? RASTER_DPI;
  const quality = checkQuality(opts.quality ?? JPEG_QUALITY);
  if (!Number.isFinite(dpi) || dpi < 36 || dpi > 600) {
    throw new RangeError(`dpi must be between 36 and 600, got ${dpi}`);
  }
  const doc = await openPdf(await readBlob(file), host.pdfOptions());
  const scale = dpi / 72; // pdfjs viewports are in CSS pixels, and a PDF point is 1/72 of one
  const pages: CleanPage[] = [];
  try {
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      try {
        const size = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.ceil(viewport.width));
        const height = Math.max(1, Math.ceil(viewport.height));
        const surface = host.surface(width, height);
        const parameters = { canvas: surface.target, viewport } as unknown as RenderParameters;
        await page.render(parameters).promise;
        pages.push({
          image: await surface.encode("jpeg", quality),
          kind: "jpg",
          width: size.width,
          height: size.height,
        });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.cleanup();
  }
  return pages;
};

/** A PDF built entirely out of the given pages: no text layer, no fonts, no attachments, no history. */
/**
 * pdf-lib stamps the clock the moment it is asked to make a document, and a cleaned file that says what
 * time it was cleaned is a clue a panel could line up against the block a tip was submitted at. Nothing in
 * a cleaned PDF is allowed to be about the tipster's moment, so the stamps go before the bytes are written.
 */
const stripTimestamps = (doc: PDFDocument): void => {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (!(info instanceof PDFDict)) return;
  for (const key of ["CreationDate", "ModDate"]) info.delete(PDFName.of(key));
};

/** A PDF built entirely out of the given pages: no text layer, no fonts, no attachments, no history. */
export const rebuildPdf = async (pages: readonly CleanPage[]): Promise<Blob> => {
  const doc = await PDFDocument.create();
  for (const page of pages) {
    const image = page.kind === "png" ? await doc.embedPng(page.image) : await doc.embedJpg(page.image);
    const sheet = doc.addPage([page.width, page.height]);
    sheet.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
  }
  doc.setProducer(CLEAN_TOOL);
  doc.setCreator(CLEAN_TOOL);
  stripTimestamps(doc);
  return blobOf(await doc.save(), "application/pdf");
};

export const rasterisePdf = async (file: Blob, host: CanvasHost, opts?: PdfOptions): Promise<Blob> =>
  rebuildPdf(await pdfPages(file, host, opts));
