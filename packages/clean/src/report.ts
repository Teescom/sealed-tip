// What was removed, per file — shown to the tipster; hashed into cleaning_report_hash. Contains no PII (S-6.11).
//
// Two jobs, and the second is the reason this file exists at all. The first is a list the tipster can
// read: your invoice had an author, a producer, an editing history and two saved versions of itself, and
// here is what is gone now. The second is that producing the list requires having *looked*, and looking
// means re-opening the cleaned file and demanding that each thing we claim to have removed is really
// absent from it. A cleaner that reports what it meant to do is a cleaner that can be quietly broken;
// this one fails loudly instead, because a tipster who believes a file is clean is the whole product.
//
// The report carries tag *names* and counts, never values — "Author", not a name — so the one object that
// describes what was private is not itself private. It travels inside the encrypted bundle and its hash
// goes on-chain, so a report that gained a value by accident would be visible in both places.
import exifr from "exifr";
import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import { RefusedType, type Supported } from "./gate.js";
import { readBlob, type CanvasHost } from "./host.js";
import { CLEAN_TOOL, openPdf } from "./pdf.js";

export interface FileReport {
  name: string;
  type: string;
  /** PDF only: the page count survives cleaning, and the tipster wants to know it did. */
  pages?: number;
  removed: string[];
  scanMode: boolean;
}

export interface CleaningReport {
  files: FileReport[];
  warnings: string[];
}

export interface ReportInput {
  name: string;
  /** The type the gate sniffed out of the original's bytes; the cleaned file is the same type. */
  type: Supported;
  original: Blob;
  cleaned: Blob;
  scanMode: boolean;
  /** The host the file was cleaned with. Reading a PDF is pdfjs work, and pdfjs needs to be told what environment it is in. */
  host: CanvasHost;
}

/** Thrown when a cleaned file still carries something the report was about to claim it did not. */
export class CleaningFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleaningFailed";
  }
}

export const SCAN_WARNING = "Scan mode makes printer tracking dots hard to see; it is a mitigation, not a guarantee.";

/**
 * What exifr reports about a container rather than about the photograph inside it: geometry and encoding,
 * which a re-encoded file legitimately still has. Every other name exifr returns has to not survive
 * cleaning, so a tag this list has never met makes the cleaner throw rather than go unreported.
 */
const CONTAINER_KEYS = new Set([
  "ImageWidth",
  "ImageHeight",
  "BitsPerSample",
  "BitDepth",
  "ColorType",
  "Compression",
  "Filter",
  "Interlace",
  "Palette",
  "Transparency",
  "Gamma",
  "Orientation",
]);

const PDF_INFO_KEYS = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"];

const latin1 = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

/** How many saved versions of a PDF are in the file: one `startxref` per revision, and every older one is still readable. */
const revisionCount = (bytes: Uint8Array): number => latin1(bytes).split("startxref").length - 1;

const tagNames = async (bytes: Uint8Array): Promise<string[]> => {
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = await exifr.parse(bytes);
  } catch (error) {
    // exifr throws on bytes it cannot parse rather than returning nothing. A file that got past the gate
    // has a header we already vouch for, so this only happens if our two readers disagree about the format.
    throw new CleaningFailed(`could not read the image tags: ${String(error)}`);
  }
  if (!parsed) return [];
  return Object.keys(parsed).filter((key) => !CONTAINER_KEYS.has(key));
};

const withPdfDocument = async <T>(bytes: Uint8Array, run: (doc: PDFDocument) => Promise<T>): Promise<T> =>
  run(await PDFDocument.load(bytes.slice(), { updateMetadata: false }));

/** The Info dictionary, read as a record so both halves of this file ask the same eight questions. */
const infoValues = (doc: PDFDocument): Record<string, string | Date | undefined> => ({
  Title: doc.getTitle(),
  Author: doc.getAuthor(),
  Subject: doc.getSubject(),
  Keywords: doc.getKeywords(),
  Creator: doc.getCreator(),
  Producer: doc.getProducer(),
  CreationDate: doc.getCreationDate(),
  ModDate: doc.getModificationDate(),
});

/**
 * pdfjs gives the XMP packet back as its raw XML, values and all, so this pulls out names only. The rule
 * is XMP's own: every property is namespace-qualified, and the reserved prefixes are not properties —
 * `rdf:` is the packaging that holds them, `xml:` and `xmlns` describe the packet, `x:` is its outer
 * wrapper, so anything else is either a property worth naming or an unqualified delimiter that is not.
 * Names are sorted and capped,
 * because a file can always contain more properties than a report should carry, and a tipster reading
 * "here is what came off your document" should not be handed an enumeration of somebody else's whole schema.
 */
const XMP_RESERVED_PREFIXES = new Set(["xmlns", "xml", "rdf", "x"]);

export const MAX_REPORTED_TAGS = 64;

const xmpPropertyNames = (xml: string): string[] => {
  const names = new Set<string>();
  const add = (name: string | undefined): void => {
    if (!name || !name.includes(":")) return;
    if (XMP_RESERVED_PREFIXES.has(name.slice(0, name.indexOf(":")).toLowerCase())) return;
    names.add(name);
  };
  for (const [, , tag] of xml.matchAll(/<(\/?)([A-Za-z][\w.-]*(?::[A-Za-z][\w.-]*)?)(?=[\s/>])/g)) add(tag);
  for (const [, attribute] of xml.matchAll(/[\s]([A-Za-z][\w.-]*(?::[A-Za-z][\w.-]*)?)="/g)) add(attribute);
  return [...names].sort((a, b) => a.localeCompare(b)).slice(0, MAX_REPORTED_TAGS);
};

const xmpNames = async (doc: PDFDocumentProxy): Promise<string[]> => {
  const { metadata } = await doc.getMetadata();
  if (!metadata) return [];
  const raw = metadata.getRaw() as unknown;
  // An XMP block this reader cannot enumerate is still an XMP block that has to be reported and removed.
  return typeof raw === "string" ? xmpPropertyNames(raw) : ["xmp metadata"];
};

/** Whether a PDF has a text layer a reader could search: the invisible ink that survives a highlighter. */
const hasTextLayer = async (doc: PDFDocumentProxy): Promise<boolean> => {
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    if (content.items.some((item) => "str" in item && item.str.trim().length > 0)) return true;
  }
  return false;
};

/** Open one pdfjs document per PDF examined. */
const withPdfjs = async <T>(
  bytes: Uint8Array,
  hostOptions: Record<string, unknown>,
  run: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> => {
  const doc = await openPdf(bytes, hostOptions);
  try {
    return await run(doc);
  } finally {
    await doc.cleanup();
  }
};

const describePdf = async (
  bytes: Uint8Array,
  hostOptions: Record<string, unknown>,
): Promise<{ removed: Set<string>; pages: number; warnings: string[] }> => {
  const warnings: string[] = [];
  const removed = new Set<string>();
  const revisions = revisionCount(bytes);
  const info = await withPdfDocument(bytes, async (doc) => infoValues(doc));
  for (const key of PDF_INFO_KEYS) if (info[key] !== undefined) removed.add(key);
  // An appended revision is invisible to that read — pdf-lib follows the newest xref — while its objects are
  // still in the file. With more than one revision, every Info key name anywhere in the bytes is reported.
  if (revisions > 1) {
    const text = latin1(bytes);
    for (const key of PDF_INFO_KEYS) if (text.includes(`/${key}`)) removed.add(key);
    removed.add(`document history (${revisions} saved versions)`);
    warnings.push(
      `This file held ${revisions} saved versions of itself. Older versions of a PDF stay in the file, including the metadata the current version no longer shows.`,
    );
  }
  const { pages, xmp, hadText, attachments } = await withPdfjs(bytes, hostOptions, async (doc) => ({
    pages: doc.numPages,
    xmp: await xmpNames(doc),
    hadText: await hasTextLayer(doc),
    attachments: (await doc.getAttachments()) ?? new Map(),
  }));
  for (const name of xmp) removed.add(name);
  if (hadText) removed.add("selectable text");
  if (attachments.size > 0) {
    removed.add(`embedded files (${attachments.size})`);
    warnings.push(
      `This file had ${attachments.size} file(s) embedded in it. They were dropped, not cleaned — if one of them was evidence, it is not in your bundle.`,
    );
  }
  return { removed, pages, warnings };
};

const assertPdfClean = async (bytes: Uint8Array, hostOptions: Record<string, unknown>): Promise<void> => {
  const revisions = revisionCount(bytes);
  if (revisions !== 1) {
    throw new CleaningFailed(`the rebuilt PDF has ${revisions} revisions; a rebuild should have exactly one`);
  }
  const info = await withPdfDocument(bytes, async (doc) => infoValues(doc));
  // Producer and Creator are ours on purpose, so a reader can tell a cleaned file from an original; that is
  // the only metadata a cleaned PDF is allowed to carry.
  const leaks = PDF_INFO_KEYS.filter(
    (key) =>
      info[key] !== undefined &&
      !(key === "Producer" && info[key] === CLEAN_TOOL) &&
      !(key === "Creator" && info[key] === CLEAN_TOOL),
  );
  if (leaks.length > 0) throw new CleaningFailed(`the rebuilt PDF still carries ${leaks.join(", ")}`);
  const { xmp, text } = await withPdfjs(bytes, hostOptions, async (doc) => ({
    xmp: await xmpNames(doc),
    text: await hasTextLayer(doc),
  }));
  if (xmp.length > 0) throw new CleaningFailed(`the rebuilt PDF still carries an XMP packet (${xmp.join(", ")})`);
  if (text) throw new CleaningFailed("the rebuilt PDF still has a text layer, so it was not rasterised");
};

/** One file's report, plus whatever the tipster needs to be told beyond the list. */
export const describeFile = async (
  input: ReportInput,
): Promise<{ report: FileReport; warnings: string[] }> => {
  const original = await readBlob(input.original);
  const cleaned = await readBlob(input.cleaned);
  const base = {
    name: input.name,
    type: input.type,
    removed: [] as string[],
    scanMode: input.scanMode,
  };
  if (input.type === "application/pdf") {
    const hostOptions = input.host.pdfOptions();
    await assertPdfClean(cleaned, hostOptions);
    const { removed, pages, warnings } = await describePdf(original, hostOptions);
    return { report: { ...base, pages, removed: [...removed].sort() }, warnings };
  }
  if (input.type === "image/jpeg" || input.type === "image/png") {
    const removed = await tagNames(original);
    const survivors = await tagNames(cleaned);
    if (survivors.length > 0) {
      throw new CleaningFailed(`the re-encoded image still reports ${survivors.join(", ")}`);
    }
    // Scan mode is not metadata removal, so it says what it took off: the colour, and with it the
    // faint-dot grid a printer stamp is made of.
    if (input.scanMode) removed.push("colour (grayscale)");
    return { report: { ...base, removed: [...new Set(removed)].sort() }, warnings: input.scanMode ? [SCAN_WARNING] : [] };
  }
  throw new RefusedType(`nothing cleans ${input.type}`);
};

export const buildReport = async (inputs: readonly ReportInput[]): Promise<CleaningReport> => {
  const files: FileReport[] = [];
  const warnings: string[] = [];
  for (const input of inputs) {
    const perFile = await describeFile(input);
    files.push(perFile.report);
    for (const warning of perFile.warnings) if (!warnings.includes(warning)) warnings.push(warning);
  }
  return { files, warnings };
};
