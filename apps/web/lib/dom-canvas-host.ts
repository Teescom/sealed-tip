// The browser half of the canvas port that `packages/clean` talks through (S-6.7, S-10.4).
//
// `packages/clean` deliberately cannot reach a DOM: a cleaning package with `document` in it is a package
// whose tests need a browser, and a cleaning package that imports `@napi-rs/canvas` is a package that ships
// a native image library to a tipster's phone. So the port lives there and both hosts live outside it — the
// Node one in `packages/clean/test/node_host.ts`, this one here.
//
// What this file adds over the Node host is nothing. Same `Surface` contract, same 0..1 quality scale, same
// "copy the pixels out, never hand back a live view" rule. That is the property worth protecting: a cleaner
// that behaves differently in the browser than it did in the test that vouched for it is the exact failure
// mode a tipster cannot see.
//
// The DOM is reached through three injectable primitives rather than directly, for the same reason the port
// exists at all: a Node test can prove this host's arithmetic (pixel round trip, decode-and-draw at native
// size, quality passed through unmangled) against a fake canvas, and the only thing left untested is whether
// `HTMLCanvasElement` really behaves like the fake — which is the browser's answer, not ours.
import type { CanvasHost, Surface } from "@sealedtip/clean";

/** The 2D context methods this host uses, stated as a structural type so a test fake can satisfy it. */
export interface Context2dLike {
  drawImage: (source: ImageLike, dx: number, dy: number) => void;
  getImageData: (x: number, y: number, width: number, height: number) => { data: Uint8ClampedArray };
  createImageData: (width: number, height: number) => { data: Uint8ClampedArray };
  putImageData: (image: { data: Uint8ClampedArray }, x: number, y: number) => void;
}

export interface CanvasLike {
  readonly width: number;
  readonly height: number;
  getContext: (kind: "2d") => Context2dLike | null;
}

export interface ImageLike {
  readonly width: number;
  readonly height: number;
}

export type EncodeKind = "png" | "jpeg";

/** How a surface becomes file bytes: the canvas, the format, and the 0..1 quality or `undefined` for the browser's default. */
export type Encoder = (
  canvas: CanvasLike,
  kind: EncodeKind,
  quality: number | undefined,
) => Promise<Uint8Array>;

export interface DomCanvasDeps {
  /** Default: an `OffscreenCanvas` where the browser has one, else a detached `HTMLCanvasElement`. */
  readonly createCanvas?: (width: number, height: number) => CanvasLike;
  /** Default: `createImageBitmap` over a Blob of the bytes, which is what decodes PNG and JPEG off-thread. */
  readonly decodeImage?: (bytes: Uint8Array) => Promise<ImageLike>;
  /** Default: `convertToBlob` or `toBlob`, whichever this canvas kind implements. */
  readonly encode?: Encoder;
  /** Default: hand pdfjs a module worker over its own worker bundle, once. */
  readonly setupPdfWorker?: () => void;
}

const requireSize = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive whole number of pixels, got ${value}`);
  }
  return value;
};

const browserCanvas = (width: number, height: number): CanvasLike => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  if (typeof document === "undefined") {
    throw new Error("this canvas host needs a browser; pass deps.createCanvas to run the cleaners elsewhere");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as CanvasLike;
};

const contextOf = (canvas: CanvasLike): Context2dLike => {
  const context = canvas.getContext("2d");
  // A null context is not a rare branch here: it is what the browser says when a page with hundreds of
  // megapixels of canvas has run out of GPU memory, and the honest answer is to stop rather than clean a
  // tip against a surface that silently holds nothing.
  if (context === null) throw new Error("the browser refused a 2d canvas context (memory exhausted?)");
  return context;
};

const browserDecode = async (bytes: Uint8Array): Promise<ImageLike> => {
  if (typeof createImageBitmap !== "function") throw new Error("this browser has no createImageBitmap for the cleaners");
  // A copy, the same way `openPdf` copies its bytes: `createImageBitmap` may take ownership of the buffer
  // it is handed, and these bytes are the tipster's original file in memory.
  // The MIME type is a hint only — the decoder reads the header, and the gate has already proved it is PNG or JPEG.
  return await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
};

const canvasToBytes = async (
  canvas: CanvasLike,
  kind: EncodeKind,
  quality: number | undefined,
): Promise<Uint8Array> => {
  const mime = kind === "png" ? "image/png" : "image/jpeg";
  const offscreen = canvas as unknown as {
    convertToBlob?: (options: { type: string; quality?: number }) => Promise<Blob>;
  };
  if (typeof offscreen.convertToBlob === "function") {
    const options = quality === undefined ? { type: mime } : { type: mime, quality };
    return new Uint8Array(await (await offscreen.convertToBlob(options)).arrayBuffer());
  }
  const element = canvas as unknown as {
    toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
  };
  if (typeof element.toBlob !== "function") throw new Error("this canvas cannot encode an image");
  return new Promise<Uint8Array>((resolve, reject) => {
    element.toBlob?.(
      (blob) => {
        if (blob === null) {
          // A null blob from `toBlob` is the encoder refusing, most often for a canvas the browser thinks is
          // too large — and a cleaner that resolved to empty bytes here would produce an empty, "clean" file.
          reject(new Error(`the browser refused to encode a ${canvas.width}x${canvas.height} canvas as ${mime}`));
          return;
        }
        void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      mime,
      quality,
    );
  });
};

const surfaceOf = (canvas: CanvasLike, encode: Encoder): Surface => {
  const context = contextOf(canvas);
  return {
    width: canvas.width,
    height: canvas.height,
    // pdfjs's own canvas factory wants the canvas, not the context, and `packages/clean` hands this value
    // straight to `page.render({ canvas, viewport })`.
    target: canvas,
    read: async () => Uint8Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
    write: async (pixels: Uint8Array) => {
      const image = context.createImageData(canvas.width, canvas.height);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
    },
    encode: async (kind, quality) => await encode(canvas, kind, quality),
  };
};

/**
 * Point pdfjs at its worker bundle, once, and only if it can be done.
 *
 * The bundler has to see a literal `new Worker(new URL(…))` to emit the worker file, which is why this is
 * not behind a dependency-injected path string. If the worker cannot be created — a bundler that did not
 * emit it, a browser that blocks module workers — pdfjs falls back to running on the main thread. That is
 * slower and it is not a privacy difference: the same rendering code runs either way.
 */
let workerAttempted = false;
const defaultPdfWorker = (): void => {
  if (workerAttempted) return;
  workerAttempted = true;
  try {
    const worker = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url), {
      type: "module",
    });
    // Imported for the singleton it hands back: `packages/clean` and this file must configure the *same*
    // pdfjs module instance, or the worker port is set on an object the cleaner never reads.
    void import("pdfjs-dist/legacy/build/pdf.mjs").then(({ GlobalWorkerOptions }) => {
      GlobalWorkerOptions.workerPort = worker;
    });
  } catch {
    // Left unset on purpose. `getDocument` then does its own main-thread fallback.
  }
};

/** The host `cleanFile` and `buildReport` are run with in a tipster's browser. */
export const domCanvasHost = (deps: DomCanvasDeps = {}): CanvasHost => {
  const createCanvas = deps.createCanvas ?? browserCanvas;
  const decodeImage = deps.decodeImage ?? browserDecode;
  const encode = deps.encode ?? canvasToBytes;
  const setupPdfWorker = deps.setupPdfWorker ?? defaultPdfWorker;
  let pdfConfigured = false;

  return {
    surface: (width, height) => {
      const canvas = createCanvas(requireSize("width", width), requireSize("height", height));
      return surfaceOf(canvas, encode);
    },

    decode: async (bytes: Uint8Array) => {
      const image = await decodeImage(bytes);
      const canvas = createCanvas(requireSize("width", image.width), requireSize("height", image.height));
      const context = contextOf(canvas);
      context.drawImage(image, 0, 0);
      return surfaceOf(canvas, encode);
    },

    pdfOptions: () => {
      // A browser host needs none of the Node host's font and canvas flags — its pdfjs already has a DOM —
      // but it does need to be asked for its worker before the first document opens, and this is the only
      // hook the port gives us that runs before every render.
      if (!pdfConfigured) {
        pdfConfigured = true;
        setupPdfWorker();
      }
      return {};
    },
  };
};
