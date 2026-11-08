// Generates the four fictional fixtures the cleaning tests and the demo read (S-6.12).
//
//   pnpm make:fixtures
//
// Two rules the file enforces on itself. Everything in them is invented - names, invoice numbers,
// coordinates, serials - because a real document in a public repo is a real person's leak. And every
// fixture is *verified after it is written*: the generator parses its own output back with pdf.js and
// exifr and fails if the metadata it means to plant is not actually there. A dirty fixture that silently
// stopped being dirty would make every cleaning test pass for the wrong reason, which is the one failure
// mode this phase cannot afford.
//
// Determinism is the other property worth defending: the same generator run twice must produce the same
// bytes, or `fixtures/files/` turns into churn nobody can review. The raster through @napi-rs/canvas is
// fixed, the zip is store-only, the PDF timestamps are pinned to a constant, and the file ends with the
// sha256 of each output so a reviewer can check it.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } from "pdf-lib";
import exifr from "exifr";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { buildExifTiff, degreesToRationals, jpegWithExif, pngWithExif, zipRead, zipStore } from "./fixture_bytes.js";

/** Pinned so the fixtures do not change when the clock does. */
const FIXED_UTC = Date.UTC(2026, 5, 2, 11, 4, 0);
const OUT_DIR = new URL("../../../fixtures/files", import.meta.url).pathname;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" rdf:about="">
   <dc:creator><rdf:Seq><rdf:li>J. Okafor</rdf:li></rdf:Seq></dc:creator>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Invoice 4718</rdf:li></rdf:Alt></dc:title>
  </rdf:Description>
  <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" rdf:about="">
   <xmp:CreatorTool>Acme Ledger Export 3.1</xmp:CreatorTool>
   <xmp:MetadataDate>2026-06-02T11:04:00Z</xmp:MetadataDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/**
 * The PDF a bookkeeper actually exports: an Info dictionary naming who made it, a producer string, an
 * XMP packet repeating the author, and - the part a re-save never shows you - one incremental update,
 * so the original revision and its Author entry are still in the file after the "clean" final revision
 * dropped them. Cleaning has to rebuild the document, not edit its trailer.
 */
const makeInvoicePdf = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  doc.setTitle("Invoice 4718 - ACME Industrial Parts (FICTIONAL)");
  doc.setAuthor("J. Okafor");
  doc.setProducer("Acme Invoice Engine 3.1");
  doc.setCreator("Acme Ledger Export 3.1");
  doc.setCreationDate(new Date(FIXED_UTC));
  doc.setModificationDate(new Date(FIXED_UTC));

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 300]);
  const line = (text: string, y: number, size: number): void => {
    page.drawText(text, { x: 30, y, size, font, color: rgb(0.08, 0.08, 0.1) });
  };
  line("ACME INDUSTRIAL PARTS  (FICTIONAL COMPANY)", 262, 13);
  line("Invoice 4718          Total: NGN 2,400,000.00", 236, 11);
  line("Goods delivered to a fictitious address.", 218, 9);
  line("Prepared by: J. Okafor, accounts desk", 196, 9);
  line("Internal reference: ACME-LEDGER-4718-OKAFOR", 178, 9);

  const metadata = doc.context.register(
    PDFRawStream.of(
      doc.context.obj({ Type: "Metadata", Subtype: "XML" }),
      new Uint8Array(Buffer.from(XMP, "latin1")),
    ),
  );
  doc.catalog.set(PDFName.of("Metadata"), metadata);

  const first = new Uint8Array(await doc.save({ useObjectStreams: false }));
  return appendIncrementalRevision(first);
};

/**
 * Append a second revision the way a real editor does: one new object, a single-entry xref subsection, a
 * trailer that points back at the previous one. The final revision has no Author - which is exactly why
 * a tipster would believe it is clean - while revision 1 still carries `/Author (J. Okafor)` in the same
 * file, ahead of `/Prev`.
 */
const appendIncrementalRevision = (base: Uint8Array): Uint8Array => {
  const text = latin1(base);
  const startxref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1];
  const size = /\/Size\s+(\d+)/.exec(text)?.[1];
  const root = /\/Root\s+(\d+ \d+ R)/.exec(text)?.[1];
  if (startxref === undefined || size === undefined || root === undefined) {
    throw new Error("could not read the saved PDF trailer to append a revision");
  }
  const info = Number(size);
  const object = `\n${info} 0 obj\n<< /Title (Invoice 4718 - ACME Industrial Parts (FICTIONAL)) /Producer (Acme Invoice Engine 3.1) /ModDate (D:20260602111500Z) >>\nendobj\n`;
  // The object text starts with the newline that separates it from the previous %%EOF, so the offset an
  // xref entry records is one past where the appended bytes begin - while the xref table follows the whole
  // object, newline included. Getting these two the same is the off-by-one that makes the file unreadable.
  const objectAt = base.length + 1;
  const xrefAt = base.length + Buffer.byteLength(object, "latin1");
  const entry = (offset: number): string => `${String(offset).padStart(10, "0")} 00000 n \n`;
  const xref =
    `xref\n0 1\n0000000000 65535 f \n${info} 1\n${entry(objectAt)}trailer\n` +
    `<< /Size ${info + 1} /Root ${root} /Info ${info} 0 R /Prev ${startxref} >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array([...base, ...Buffer.from(object + xref, "latin1")]);
};

/** Little-endian TIFF with the tags a phone writes: make, model, software, artist, and a GPS sub-IFD. */
const phoneExif = (): Uint8Array => {
  const latitude = 6.5244;
  const longitude = 3.3792;
  const ifd0 = [
    { tag: 0x010f, field: { kind: "ascii", text: "Fictiophone X2" } as const },
    { tag: 0x0110, field: { kind: "ascii", text: "FX2-0000FAKE" } as const },
    { tag: 0x0131, field: { kind: "ascii", text: "FictiCamera App 4.2" } as const },
    { tag: 0x013b, field: { kind: "ascii", text: "J. Okafor" } as const },
    { tag: 0x0132, field: { kind: "ascii", text: "2026:06:02 11:04:00" } as const },
    { tag: 0x8825, field: { kind: "gpsPointer" } as const },
  ];
  const gps = [
    { tag: 0x0001, field: { kind: "ascii", text: "N" } as const },
    { tag: 0x0002, field: { kind: "rationals", pairs: degreesToRationals(latitude) } as const },
    { tag: 0x0003, field: { kind: "ascii", text: "E" } as const },
    { tag: 0x0004, field: { kind: "rationals", pairs: degreesToRationals(longitude) } as const },
    { tag: 0x0005, field: { kind: "byte", value: 0 } as const },
    { tag: 0x0006, field: { kind: "rationals", pairs: [[41, 1]] } as const },
    { tag: 0x0012, field: { kind: "ascii", text: "WGS-84" } as const },
  ];
  return buildExifTiff(ifd0, gps);
};

/** A warehouse photo: sky, racks, a forklift silhouette. Nothing real, nothing identifying. */
const makePhotoJpeg = (): Uint8Array => {
  const canvas = createCanvas(1024, 768);
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, 420);
  sky.addColorStop(0, "#8fb7d6");
  sky.addColorStop(1, "#d9e6ee");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 420);
  ctx.fillStyle = "#6b7280";
  ctx.fillRect(0, 420, 1024, 348);
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? "#9aa3ad" : "#7d8794";
    ctx.fillRect(60 + i * 150, 250, 110, 170);
  }
  ctx.fillStyle = "#3f3f46";
  ctx.fillRect(430, 470, 210, 90);
  ctx.fillRect(560, 420, 60, 50);
  ctx.fillStyle = "#facc15";
  ctx.fillRect(452, 560, 166, 14);
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(470, 592, 26, 0, Math.PI * 2);
  ctx.arc(600, 592, 26, 0, Math.PI * 2);
  ctx.fill();
  return jpegWithExif(canvas.toBuffer("image/jpeg", 88), phoneExif());
};

/**
 * A flatbed scan with the pale-yellow dots a colour laser printer bakes into every page. They sit at
 * roughly 0.42 mm pitch, which at 300 dpi is about 5 px - and they are ~96% luminance, so they are
 * invisible on screen and unmistakable in the pixel data.
 */
const makeScanPng = (): Uint8Array => {
  const canvas = createCanvas(900, 1200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 900, 1200);
  ctx.fillStyle = "#f4f2ee";
  ctx.fillRect(0, 0, 900, 26);
  ctx.fillStyle = "#111827";
  ctx.font = "20px sans-serif";
  ctx.fillText("TRANSACTION LEDGER EXTRACT - PAGE 3 OF 7", 60, 90);
  ctx.font = "15px sans-serif";
  for (let row = 0; row < 22; row += 1) {
    const y = 150 + row * 34;
    ctx.fillText(`ACME-${String(4700 + row).padStart(4, "0")}   ${String(1000 * row + 250)}   FG${String(row * 7).padStart(3, "0")}`, 60, y);
  }
  ctx.fillStyle = "rgb(255,251,140)";
  for (let x = 40; x < 860; x += 5) {
    for (let y = 1010; y < 1120; y += 5) {
      ctx.fillRect(x, y, 2, 2);
    }
  }
  return pngWithExif(canvas.toBuffer("image/png"), phoneExif());
};

/** DOCX is a zip. The gate must refuse it: cleaning a format you cannot rasterise is how leaks survive. */
const makeMemoDocx = (): Uint8Array => {
  const entry = (name: string, text: string): { name: string; data: Uint8Array } => ({
    name,
    data: new Uint8Array(Buffer.from(text, "utf8")),
  });
  return zipStore(
    [
      entry(
        "[Content_Types].xml",
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      ),
      entry(
        "_rels/.rels",
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      ),
      entry(
        "word/document.xml",
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Internal memo (FICTIONAL): the ledger extract has been copied off-site by J. Okafor.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
      ),
      entry(
        "docProps/core.xml",
        '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>J. Okafor</dc:creator><cp:lastModifiedBy>J. Okafor</cp:lastModifiedBy><dc:title>Internal memo</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">2026-06-02T11:04:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-06-02T11:04:00Z</dcterms:modified></cp:coreProperties>',
      ),
      entry(
        "docProps/app.xml",
        '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Fictitious Office Writer 1.0</Application><Company>ACME Industrial Parts (FICTIONAL)</Company><TotalTime>7</TotalTime></Properties>',
      ),
    ],
    FIXED_UTC,
  );
};

/**
 * A hand-appended revision is only a revision if its offsets are true, so the offsets get checked rather
 * than trusted: every `startxref` must land on an `xref` keyword, every in-use entry in the final table
 * must land on its own `N 0 obj`, and `/Prev` must point at the revision below.
 *
 * This is in the file because both of the bugs it catches were invisible to a substring check - the
 * broken output still contained `/Prev`, `/Author` and the XMP packet, and pdf.js papered over the rest
 * by brute-indexing the whole file. A fixture that is not a valid PDF is worse than no fixture.
 */
const expectRevisionOffsets = (pdf: string): void => {
  const fail = (what: string): never => {
    throw new Error(`fixture verification failed: ${what}`);
  };
  const tables = [...pdf.matchAll(/startxref\s+(\d+)/g)].map((match) => Number(match[1]));
  if (tables.length !== 2) return fail(`expected two revisions' startxref, saw ${tables.length}`);
  const first = tables[0] ?? fail("no first startxref");
  const last = tables[1] ?? fail("no final startxref");
  for (const at of tables) if (pdf.slice(at, at + 4) !== "xref") return fail(`startxref ${at} does not point at an xref table`);
  const prev = Number(/\/Prev\s+(\d+)/.exec(pdf.slice(last))?.[1]);
  if (prev !== first) return fail(`/Prev is ${prev}, but the first revision's xref is at ${first}`);

  const body = pdf.slice(last, pdf.indexOf("trailer", last));
  let number = 0;
  for (const line of body.split("\n")) {
    const subsection = /^(\d+) (\d+)$/.exec(line);
    if (subsection !== null) {
      number = Number(subsection[1]);
      continue;
    }
    const entry = /^(\d{10}) (\d{5}) ([nf]) $/.exec(line);
    if (entry === null) continue;
    if (entry[3] === "n") {
      const offset = Number(entry[1]);
      const header = `${number} 0 obj`;
      if (pdf.slice(offset, offset + header.length) !== header) {
        return fail(`xref entry for object ${number} points at ${JSON.stringify(pdf.slice(offset, offset + 12))}, not "N 0 obj"`);
      }
    }
    number += 1;
  }
};

/**
 * Prove each fixture on disk is actually dirty, with the parsers the cleaners use. Reading the written
 * file back is the only check that means anything - it is the bytes that get committed and that the
 * cleaning tests open, not what the builder held in memory - and a fixture that quietly stopped carrying
 * a tag would turn every cleaning test into a pass that proves nothing.
 */
const verify = async (): Promise<void> => {
  const read = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(OUT_DIR, name)));
  const expect = (condition: boolean, what: string): void => {
    if (!condition) throw new Error(`fixture verification failed: ${what}`);
  };

  const pdf = latin1(read("invoice_fictional.pdf"));
  expect(pdf.includes("/Prev"), "the PDF has no incremental-update revision");
  expect(/\/Author\s*[(<]/.test(pdf), "the PDF's first revision lost its Author entry");
  expect(pdf.includes("J. Okafor"), "the PDF lost the author name the revision was supposed to hide");
  expect(pdf.includes("x:xmpmeta"), "the PDF lost its XMP packet");
  expect(pdf.includes("/Producer"), "the PDF lost its Producer string");
  expectRevisionOffsets(pdf);
  const loaded = await getDocument({ data: read("invoice_fictional.pdf") }).promise;
  expect(loaded.numPages === 1, `the rebuilt PDF should have 1 page, saw ${loaded.numPages}`);
  const info = (await loaded.getMetadata()).info as Record<string, unknown>;
  expect(info["Author"] === undefined, `the final revision still reports an Author: ${String(info["Author"])}`);
  expect(typeof info["Title"] === "string", "pdf.js could not read the revision's Info dictionary");

  for (const name of ["photo_gps.jpg", "scan_with_dots.png"] as const) {
    const tags = (await exifr.parse(read(name), true)) as Record<string, unknown>;
    expect(String(tags["Make"]) === "Fictiophone X2", `${name}: no Make tag (${JSON.stringify(tags?.["Make"])})`);
    expect(String(tags["Model"]) === "FX2-0000FAKE", `${name}: no Model tag`);
    expect(String(tags["Software"]) === "FictiCamera App 4.2", `${name}: no Software tag`);
    expect(String(tags["GPSMapDatum"]) === "WGS-84", `${name}: no GPS datum tag`);
    const [lat, lon] = [Number(tags["latitude"]), Number(tags["longitude"])];
    expect(Math.abs(lat - 6.5244) < 1e-4, `${name}: GPS latitude came back as ${lat}`);
    expect(Math.abs(lon - 3.3792) < 1e-4, `${name}: GPS longitude came back as ${lon}`);
  }

  const scan = await loadImage(read("scan_with_dots.png"));
  const probe = createCanvas(scan.width, scan.height);
  const probeCtx = probe.getContext("2d");
  probeCtx.drawImage(scan, 0, 0);
  const pixels = probeCtx.getImageData(0, 0, scan.width, scan.height).data;
  let yellow = 0;
  for (let at = 0; at < pixels.length; at += 4) {
    const red = pixels[at] ?? 0;
    const green = pixels[at + 1] ?? 0;
    const blue = pixels[at + 2] ?? 0;
    if (red > 200 && green > 200 && red - blue > 40 && green - blue > 40) yellow += 1;
  }
  expect(yellow > 500, `the scan carries only ${yellow} tracking-dot pixels, so S-6.10 would prove nothing`);

  const docx = read("memo.docx");
  expect(latin1(docx).startsWith("PK"), "memo.docx is not a zip");
  const entries = zipRead(docx);
  expect(entries.size === 5, `memo.docx should hold 5 parts, saw ${entries.size}`);
  const core = latin1(entries.get("docProps/core.xml") ?? new Uint8Array());
  expect(core.includes("J. Okafor"), "memo.docx lost its author in docProps/core.xml");
  expect(core.includes("lastModifiedBy"), "memo.docx lost its last-modified-by");
};

const main = async (): Promise<void> => {
  const files: Record<string, Uint8Array> = {
    "invoice_fictional.pdf": await makeInvoicePdf(),
    "photo_gps.jpg": makePhotoJpeg(),
    "scan_with_dots.png": makeScanPng(),
    "memo.docx": makeMemoDocx(),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const before: Record<string, string> = {};
  for (const name of Object.keys(files)) {
    try {
      before[name] = sha256(new Uint8Array(readFileSync(path.join(OUT_DIR, name))));
    } catch {
      // Not there yet - the normal case on a fresh clone.
    }
  }
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(OUT_DIR, name), bytes);
  await verify();

  for (const [name, bytes] of Object.entries(files)) {
    const digest = sha256(bytes);
    const state = before[name] === undefined ? "new" : before[name] === digest ? "unchanged" : "rewritten";
    console.log(`${state}\t${bytes.length}\t${digest.slice(0, 16)}\t${name}`);
  }
};

await main();
