// The one seam through which `packages/clean` touches pixels (S-6.7–S-6.11).
//
// Everything on this side of the seam is pixel arithmetic and file structure; everything behind it is
// whatever canvas the program happens to be running in. The seam exists because of where this code has
// to run: a tipster's browser, which has a DOM canvas, and this repository's test suite, which does not.
// A runtime dependency on `@napi-rs/canvas` would put a native image library into the bundle the
// tipster downloads, and a runtime dependency on the DOM would make the cleaners untestable — so the
// Node host lives in `test/` and the DOM host is written in `apps/web` (P10), and neither is reachable
// from here.
import type { Supported } from "./gate.js";

/** An RGBA surface the cleaners own: readable, writable, encodable, and paintable by pdfjs. */
export interface Surface {
  readonly width: number;
  readonly height: number;
  /**
   * Whatever object this host's pdfjs needs as a render target. Typed as unknown on purpose: naming it
   * would drag a DOM type into a package that is compiled without the DOM library.
   */
  readonly target: unknown;
  /** 4 bytes per pixel, row-major from the top left. */
  read: () => Promise<Uint8Array>;
  write: (pixels: Uint8Array) => Promise<void>;
  /** `quality` is the 0..1 scale the canvas API uses; a host whose encoder wants 0..100 divides it. */
  encode: (kind: "png" | "jpeg", quality?: number) => Promise<Uint8Array>;
}

export interface CanvasHost {
  surface: (width: number, height: number) => Surface;
  /** Decode PNG or JPEG bytes into a surface. The gate has already proved the bytes are one of those two. */
  decode: (bytes: Uint8Array) => Promise<Surface>;
  /**
   * pdfjs options this build needs to read and render without a DOM: whether an offscreen canvas exists,
   * how glyphs get drawn (`disableFontFace`), and where the substitute standard fonts live. Deliberately
   * *not* a `CanvasFactory`: pdfjs's legacy build already carries a complete one, and a partial factory
   * passed in from outside replaces it and then gets called for the methods it does not have. A browser
   * host returns `{}`; its pdfjs needs none of this.
   */
  pdfOptions: () => Record<string, unknown>;
}

/** Dots-per-inch for a rasterised page. 150 is what a photocopier uses; a text page stays readable. */
export const RASTER_DPI = 150;
/** JPEG quality for a rasterised page or a re-encoded photo, on the 0..1 canvas scale. */
export const JPEG_QUALITY = 0.85;

/**
 * Quality is the one knob a caller can get wrong in a way that looks like success: 85 instead of 0.85
 * would be clamped to the best setting by the encoder, and the tipster's bundle would quietly grow.
 */
export const checkQuality = (quality: number): number => {
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
    throw new RangeError(`jpeg quality must be a fraction above 0 and at or below 1, got ${quality}`);
  }
  return quality;
};

/** A page of the rebuilt PDF: image bytes plus the physical size of the page it came from, in points. */
export interface CleanPage {
  readonly image: Uint8Array;
  readonly kind: "jpg" | "png";
  readonly width: number;
  readonly height: number;
}

export const readBlob = async (file: Blob): Promise<Uint8Array> =>
  new Uint8Array(await file.arrayBuffer());

export const blobOf = (bytes: Uint8Array, type: Supported): Blob => new Blob([bytes], { type });
