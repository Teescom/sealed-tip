// Decode → canvas → re-encode (drops EXIF/XMP/IPTC) (S-6.9).
//
// There is no metadata-removal step in this file, and that is the design. A cleaner that parses EXIF and
// rewrites the header has to know every tag that has ever carried a serial number, a face box, a GPS
// timestamp or a contacts list — and the day it meets one it does not know, it ships the tipster's
// address. Decoding to pixels and encoding a new file from scratch means the only thing that can survive
// is what the pixels themselves show. It is the same reason a PDF gets rasterised, one level down.
import { blobOf, checkQuality, JPEG_QUALITY, readBlob, type CanvasHost } from "./host.js";

export interface ReencodeOptions {
  /** JPEG quality, 0..1, for a file that was already a JPEG. A PNG is re-encoded losslessly. */
  quality?: number;
}

/** PNG in gives PNG out, JPEG in gives JPEG out: a photo should not grow tenfold to lose one tag. */
export const reencodeBytes = async (
  bytes: Uint8Array,
  host: CanvasHost,
  opts: ReencodeOptions = {},
): Promise<{ image: Uint8Array; kind: "jpg" | "png" }> => {
  const isPng = bytes[0] === 0x89;
  const quality = checkQuality(opts.quality ?? JPEG_QUALITY);
  const surface = await host.decode(bytes);
  const image = await surface.encode(isPng ? "png" : "jpeg", isPng ? undefined : quality);
  return { image, kind: isPng ? "png" : "jpg" };
};

export const reencodeImage = async (
  file: Blob,
  host: CanvasHost,
  opts?: ReencodeOptions,
): Promise<Blob> => {
  const { image, kind } = await reencodeBytes(await readBlob(file), host, opts);
  return blobOf(image, kind === "jpg" ? "image/jpeg" : "image/png");
};
