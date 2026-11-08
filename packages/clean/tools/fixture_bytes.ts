// The byte-level writers the fictional fixtures need (S-6.12).
//
// These formats are hand-rolled on purpose. EXIF and zip are the two things a *dirty* fixture has to
// really carry, and the only npm packages that write them pull a native image library or a full
// compression stack into the shipped cleaning package. `packages/clean` must stay small: it is loaded
// in the tipster's browser before anything is uploaded, and every kilobyte here is a kilobyte that can
// delay or leak on a bad connection. So: store-only zip, a minimal little-endian TIFF, and one chunk
// insert each for JPEG and PNG. About 200 lines, and the fixtures' own verification pass is its test.
import { Buffer } from "node:buffer";

export type Field =
  | { kind: "ascii"; text: string }
  | { kind: "byte"; value: number }
  | { kind: "short"; value: number }
  | { kind: "long"; value: number }
  | { kind: "rationals"; pairs: readonly (readonly [number, number])[] }
  | { kind: "srational"; pairs: readonly (readonly [number, number])[] }
  /** Tag 0x8825: a u32 pointing at the GPS sub-IFD, whose offset the layout pass computes. */
  | { kind: "gpsPointer" };

export interface TiffTag {
  tag: number;
  field: Field;
}

const TYPE_ASCII = 2;
const TYPE_BYTE = 1;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SRATIONAL = 10;

const latin1 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "latin1"));

const fieldType = (field: Field): number => {
  switch (field.kind) {
    case "ascii":
      return TYPE_ASCII;
    case "byte":
      return TYPE_BYTE;
    case "short":
      return TYPE_SHORT;
    case "gpsPointer":
    case "long":
      return TYPE_LONG;
    case "rationals":
      return TYPE_RATIONAL;
    case "srational":
      return TYPE_SRATIONAL;
  }
};

const fieldCount = (field: Field): number => {
  switch (field.kind) {
    case "ascii":
      // ASCII values are NUL-terminated in the tag itself, and the count includes the NUL.
      return field.text.length + 1;
    case "byte":
    case "short":
    case "long":
    case "gpsPointer":
      return 1;
    case "rationals":
    case "srational":
      return field.pairs.length;
  }
};

/** How the value appears in the data area; TIFF counts bytes here, not components. */
const fieldBytes = (field: Field): Uint8Array => {
  const out = new DataView(new ArrayBuffer(fieldSize(field)));
  switch (field.kind) {
    case "ascii": {
      const bytes = new Uint8Array(fieldSize(field));
      bytes.set(latin1(field.text), 0);
      return bytes;
    }
    case "byte":
      out.setUint8(0, field.value);
      return new Uint8Array(out.buffer);
    case "short":
      out.setUint16(0, field.value, true);
      return new Uint8Array(out.buffer);
    case "long":
      out.setUint32(0, field.value, true);
      return new Uint8Array(out.buffer);
    case "gpsPointer":
      return new Uint8Array(out.buffer);
    case "rationals":
    case "srational": {
      const signed = field.kind === "srational";
      field.pairs.forEach(([numerator, denominator], index) => {
        const at = index * 8;
        if (signed) out.setInt32(at, numerator, true);
        else out.setUint32(at, numerator, true);
        out.setUint32(at + 4, denominator, true);
      });
      return new Uint8Array(out.buffer);
    }
  }
};

const fieldSize = (field: Field): number => {
  switch (field.kind) {
    case "ascii":
      return field.text.length + 1;
    case "byte":
      return 1;
    case "short":
      return 2;
    case "long":
    case "gpsPointer":
      return 4;
    case "rationals":
    case "srational":
      return field.pairs.length * 8;
  }
};

/**
 * crc32 as PNG and zip both define it: reflected, seeded at all-ones, no final reversal shortcut.
 * Table-free on purpose - the fixtures are kilobytes and a table would be indexed code in a file whose
 * whole job is unindexed byte loops.
 */
export const crc32 = (data: Uint8Array): number => {
  let crc = 0xffff_ffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xed_b8_83_20 & -(crc & 1));
  }
  return (crc ^ 0xffff_ffff) >>> 0;
};

/**
 * A little-endian TIFF with one IFD0 and one GPS sub-IFD - the structure EXIF is built on.
 *
 * Layout is fixed and computed in one pass, which is what makes the file byte-reproducible:
 * header, IFD0, IFD0's out-of-line values, GPS sub-IFD, GPS's out-of-line values. Any value over four
 * bytes lives in the data area and the entry carries its absolute offset from the TIFF base.
 */
export const buildExifTiff = (ifd0: readonly TiffTag[], gps: readonly TiffTag[]): Uint8Array => {
  const ifd0Size = 2 + ifd0.length * 12 + 4;
  const ext0Size = ifd0.reduce((size, t) => size + (fieldSize(t.field) > 4 ? fieldSize(t.field) : 0), 0);
  const gpsIfdOffset = 8 + ifd0Size + ext0Size;
  const gpsSize = 2 + gps.length * 12 + 4;
  const extGpsSize = gps.reduce((size, t) => size + (fieldSize(t.field) > 4 ? fieldSize(t.field) : 0), 0);

  const out = new Uint8Array(8 + ifd0Size + ext0Size + gpsSize + extGpsSize);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  const writeIfd = (tags: readonly TiffTag[], ifdAt: number, dataAt: number, nextIfd: number): number => {
    const cursor = new DataView(out.buffer);
    cursor.setUint16(ifdAt, tags.length, true);
    let at = ifdAt + 2;
    let dataCursor = dataAt;
    for (const { tag, field } of tags) {
      const bytes = fieldBytes(field);
      cursor.setUint16(at, tag, true);
      cursor.setUint16(at + 2, fieldType(field), true);
      cursor.setUint32(at + 4, fieldCount(field), true);
      if (field.kind === "gpsPointer") cursor.setUint32(at + 8, gpsIfdOffset, true);
      else if (bytes.length <= 4) out.set(bytes, at + 8);
      else {
        cursor.setUint32(at + 8, dataCursor, true);
        out.set(bytes, dataCursor);
        dataCursor += bytes.length;
      }
      at += 12;
    }
    cursor.setUint32(at, nextIfd, true);
    return dataCursor;
  };

  writeIfd(ifd0, 8, 8 + ifd0Size, 0);
  writeIfd(gps, gpsIfdOffset, gpsIfdOffset + gpsSize, 0);
  return out;
};

/** Decimal degrees to the DMS-of-rationals form GPS tags require (degrees, minutes, seconds/100). */
export const degreesToRationals = (value: number): (readonly [number, number])[] => {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = Math.floor((absolute - degrees) * 60);
  const seconds = Math.round((((absolute - degrees) * 60 - minutes) * 60) * 100);
  return [
    [degrees, 1],
    [minutes, 1],
    [seconds, 100],
  ];
};

/** One PNG chunk: length, type, data, crc32 over type+data. */
export const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(latin1(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)), false);
  return chunk;
};

/**
 * Insert an `eXIf` chunk into a PNG after IHDR - where readers that stop scanning at the first IDAT
 * still find it. A real scanner that writes EXIF into a PNG does exactly this.
 */
export const pngWithExif = (png: Uint8Array, tiff: Uint8Array): Uint8Array => {
  const signature = 8;
  const ihdrLength = new DataView(png.buffer, png.byteOffset).getUint32(signature, false);
  const afterIhdr = signature + 12 + ihdrLength;
  const chunk = pngChunk("eXIf", tiff);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, afterIhdr), 0);
  out.set(chunk, afterIhdr);
  out.set(png.subarray(afterIhdr), afterIhdr + chunk.length);
  return out;
};

/** Insert an APP1 `Exif\0\0` segment right after the SOI marker of a baseline JPEG. */
export const jpegWithExif = (jpeg: Uint8Array, tiff: Uint8Array): Uint8Array => {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("not a JPEG: missing SOI marker");
  const payload = latin1("Exif\0\0");
  const segment = new Uint8Array(4 + payload.length + tiff.length);
  const view = new DataView(segment.buffer);
  view.setUint16(0, 0xffe1, false);
  view.setUint16(2, payload.length + tiff.length + 2, false);
  segment.set(payload, 4);
  segment.set(tiff, 4 + payload.length);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
};

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * A store-only zip: no deflate, so the CRC and the offsets are ours rather than a compressor's, and the
 * bytes come out identical on every machine that runs the generator. DOCX is a zip, and this is the
 * smallest thing that produces a file Microsoft Word will actually open.
 */
export const zipStore = (entries: readonly ZipEntry[], dosDateTime: number): Uint8Array => {
  const stamp = new DataView(new ArrayBuffer(4));
  const date = new Date(dosDateTime);
  const dosDate = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1 << 4);
  stamp.setUint16(0, dosTime, true);
  stamp.setUint16(2, dosDate, true);

  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = latin1(name);
    const crc = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x0403_4b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    header.set(new Uint8Array(stamp.buffer), 10);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    local.push(header, data);

    const record = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(record.buffer);
    centralView.setUint32(0, 0x0201_4b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    record.set(nameBytes, 46);
    central.push(record);
    offset += header.length + data.length;
  }

  const centralBytes = central.reduce((size, part) => size + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x0605_4b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes, true);
  endView.setUint32(16, offset, true);

  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
};

/**
 * Read a store-only zip back: name to bytes, with every entry's CRC verified.
 *
 * This exists only so the generator can prove the DOCX it wrote is a zip rather than a file that starts
 * like one. The first version of `zipStore` emitted a valid-looking trailer over empty entry tables, and
 * nothing downstream noticed, because a reader that trusts the central directory sees what it expects.
 */
export const zipRead = (zip: Uint8Array): Map<string, Uint8Array> => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let at = zip.length - 22; at >= 0 && end < 0; at -= 1) {
    if (view.getUint32(at, true) === 0x0605_4b50) end = at;
  }
  if (end < 0) throw new Error("zip has no end-of-central-directory record");
  const count = view.getUint16(end + 10, true);
  const directoryAt = view.getUint32(end + 16, true);

  const entries = new Map<string, Uint8Array>();
  let at = directoryAt;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x0201_4b50) throw new Error(`zip central record ${i} is not a signature`);
    const crc = view.getUint32(at + 16, true);
    const stored = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name = Buffer.from(zip.subarray(at + 46, at + 46 + nameLength)).toString("latin1");
    if (view.getUint32(localAt, true) !== 0x0403_4b50) throw new Error(`zip local header for ${name} is missing`);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const data = zip.subarray(dataAt, dataAt + stored);
    if (crc32(data) !== crc) throw new Error(`zip entry ${name} does not match its recorded CRC`);
    entries.set(name, data);
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
};
