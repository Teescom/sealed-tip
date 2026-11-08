// Type gate: only PDF, JPEG, PNG. Everything else is REFUSED (privacy invariant 4) (S-6.7).
//
// The gate reads the first bytes because a filename and a MIME type are both things the tipster's
// operating system writes, and neither is a promise about the content. A `.docx` that has to be refused
// is the acceptance case for this file, and it is refused because refusing it is honest — the cleaners
// would have to render a word processor to clean it, and the moment we render somebody's document we
// have opened it.
export const SUPPORTED = ["application/pdf", "image/jpeg", "image/png"] as const;
export type Supported = (typeof SUPPORTED)[number];

export const REFUSAL_MESSAGE = "This file type isn't supported. Export it as PDF and try again.";

/** Thrown by `cleanFile` for anything the gate refuses, so the UI has one thing to catch. */
export class RefusedType extends Error {
  constructor(message: string = REFUSAL_MESSAGE) {
    super(message);
    this.name = "RefusedType";
  }
}

/**
 * What the bytes say the file is. `refused` covers every other format, including the ones that look
 * close: a GIF (a frame count we would silently throw away), a TIFF (the EXIF carrier we cannot re-encode
 * losslessly here), and a ZIP, which is what every Office document actually is.
 */
export const sniffType = async (file: Blob): Promise<Supported | "refused"> => {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg"; // SOI followed by a marker segment
  // The full eight-byte PNG signature, because the last two bytes are the CRLF+EOF+SUB+CR that stops a
  // hand-edited "PNG" that is really something else from passing.
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return "refused";
};

const startsWith = (bytes: Uint8Array, prefix: number[]): boolean =>
  prefix.every((byte, index) => bytes[index] === byte);
