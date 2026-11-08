// Optional scan mode: grayscale + threshold to suppress printer tracking dots. Mitigation, not a guarantee (S-6.10).
//
// The yellow-dot machine-identification stamps real printers put on documents are drawn faint and small,
// and every attack on them that works in a browser is a loss of information: take the colour away, then
// take the mid-tones away, and a dot that was 94% white becomes indistinguishable from the paper under it.
// What survives is the ink a human reads. This is why the function is called mitigation rather than
// sanitisation — a stamp printed dark enough to survive a threshold at 128 would have been dark enough to
// read, and a denser dot grid than the fixture's would still leave a residue in the halftone.
import { blobOf, readBlob, type CanvasHost } from "./host.js";

/** Luma weightings that make a colour go away the way a photocopier's does (Rec. 601). */
const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

export interface ScanOptions {
  /** Luma at or above this becomes paper white; below it becomes ink. */
  threshold?: number;
}

export const DEFAULT_THRESHOLD = 128;

/** Grayscale and threshold over PNG or JPEG bytes, returning PNG (the bilevel result deserves no lossy pass). */
export const scanBytes = async (
  bytes: Uint8Array,
  host: CanvasHost,
  opts: ScanOptions = {},
): Promise<Uint8Array> => {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    throw new RangeError(`threshold must be a luma within 0..=255, got ${threshold}`);
  }
  const surface = await host.decode(bytes);
  const pixels = await surface.read();
  for (let i = 0; i < pixels.length; i += 4) {
    // Composited over white before the luma, because that is what a viewer shows: a partly transparent
    // pixel that is really pale grey must stay pale grey, not become the dark ink its raw channels say.
    const alpha = pixels[i + 3]! / 255;
    const ink =
      luma(
        pixels[i]! * alpha + 255 * (1 - alpha),
        pixels[i + 1]! * alpha + 255 * (1 - alpha),
        pixels[i + 2]! * alpha + 255 * (1 - alpha),
      ) >= threshold
        ? 255
        : 0;
    pixels[i] = ink;
    pixels[i + 1] = ink;
    pixels[i + 2] = ink;
    pixels[i + 3] = 255;
  }
  await surface.write(pixels);
  const png = await surface.encode("png");
  return png;
};

export const scanMode = async (
  image: Blob,
  host: CanvasHost,
  opts: ScanOptions = {},
): Promise<Blob> => blobOf(await scanBytes(await readBlob(image), host, opts), "image/png");
