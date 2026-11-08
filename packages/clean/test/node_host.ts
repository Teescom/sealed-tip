// The Node implementation of the canvas port, for tests only (S-6.7–S-6.11).
//
// It lives in `test/` on purpose: `@napi-rs/canvas` is a native module, and a cleaning package that
// depends on it at runtime cannot be shipped to a tipster's browser. The browser implementation is the
// DOM canvas, and it belongs to `apps/web` (P10) — which is the other half of why the port is in `src/`
// and both hosts are outside it.
//
// One thing worth knowing before changing this file: pdfjs's legacy build does the same lookup for its own
// rendering. Its `NodeCanvasFactory` requires `@napi-rs/canvas` itself when it detects Node, which is why
// the host below hands pdfjs a canvas rather than a factory of ours — a partial factory replaces a
// complete one, and pdfjs then calls the methods it forgot.
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { CanvasHost, Surface } from "../src/host.js";

const require = createRequire(import.meta.url);

/** Where pdfjs keeps its substitutes for the 14 PDF standard fonts: the only reason a Node render looks like the browser's. */
const standardFontDataUrl = `${dirname(require.resolve("pdfjs-dist/package.json"))}/standard_fonts/`;

const raw = (width: number, height: number) => {
  const canvas = createCanvas(width, height);
  return { canvas, context: canvas.getContext("2d") };
};

const surfaceOf = ({ canvas, context }: ReturnType<typeof raw>): Surface => ({
  width: canvas.width,
  height: canvas.height,
  target: canvas,
  // A copy rather than the view `getImageData` hands back: the port promises bytes the caller may mutate,
  // and `scanBytes` does exactly that before writing them back - in a browser that view is live over the
  // surface it came from.
  read: async () => Uint8Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
  write: async (pixels: Uint8Array) => {
    const image = context.createImageData(canvas.width, canvas.height);
    image.data.set(pixels);
    context.putImageData(image, 0, 0);
  },
  // napi takes JPEG quality on 0..100; the port speaks the canvas API's 0..1.
  encode: async (kind, quality) =>
    kind === "png"
      ? new Uint8Array(canvas.toBuffer("image/png"))
      : new Uint8Array(canvas.toBuffer("image/jpeg", Math.round((quality ?? 0.85) * 100))),
});

export const nodeHost = (): CanvasHost => ({
  surface: (width, height) => surfaceOf(raw(width, height)),
  decode: async (bytes: Uint8Array) => {
    const image = await loadImage(bytes);
    const { canvas, context } = raw(image.width, image.height);
    context.drawImage(image, 0, 0);
    return surfaceOf({ canvas, context });
  },
  pdfOptions: () => ({
    isOffscreenCanvasSupported: false,
    // In a browser pdfjs can hand a font to the page as a CSS font-face; here it has to draw the glyph
    // outlines itself, which is also what makes the render comparable to the tipster's screen.
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl,
  }),
});
