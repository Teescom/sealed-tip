// S-6.7's other half: the DOM canvas host. These tests run in plain Node against a fake canvas, which is
// the whole reason `domCanvasHost` reaches the browser through three injected primitives instead of naming
// `document` itself — the arithmetic below (pixels round trip, a decode sizes the canvas from the image,
// quality survives) is what the cleaners in `packages/clean` were vouched for, and a host that gets any of
// it wrong produces a "clean" file that still carries the tipster's photo.
//
// What is left untested on purpose: whether `HTMLCanvasElement` behaves like this fake. That is the
// browser's answer, and `packages/clean/test` already proves the cleaners against the Node host, which
// shares this contract.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  domCanvasHost,
  type CanvasLike,
  type Context2dLike,
  type EncodeKind,
  type ImageLike,
} from "../lib/dom-canvas-host";

/** A canvas that stores pixels, records what was drawn onto it, and can be told the browser said no. */
class FakeCanvas implements CanvasLike {
  readonly pixels: Uint8ClampedArray;
  readonly drawn: ImageLike[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly refuse = false,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext(): Context2dLike | null {
    if (this.refuse) return null;
    const { pixels, drawn, width, height } = this;
    return {
      drawImage: (source) => {
        drawn.push(source);
      },
      getImageData: () => ({ data: pixels }),
      createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image) => {
        pixels.set(image.data);
      },
    };
  }
}

/** A host over the fake, with the sizes it was asked for and the encodes it was told to do on the way out. */
const harness = (
  onEncode?: (kind: EncodeKind, quality: number | undefined) => void,
): { host: ReturnType<typeof domCanvasHost>; made: number[][] } => {
  const made: number[][] = [];
  const host = domCanvasHost({
    createCanvas: (width, height) => {
      made.push([width, height]);
      return new FakeCanvas(width, height);
    },
    decodeImage: async () => ({ width: 1200, height: 800 }),
    setupPdfWorker: () => {},
    encode: (canvas, kind, quality) => {
      onEncode?.(kind, quality);
      return Promise.resolve(Uint8Array.from([kind === "png" ? 1 : 2, canvas.width]));
    },
  });
  return { host, made };
};

describe("the browser canvas host", () => {
  it("hands back the pixels it was given, in the same order", async () => {
    const { host } = harness();
    const surface = host.surface(4, 2);
    const written = Uint8Array.from(
      Array.from({ length: 4 * 2 * 4 }, (_, index) => (index * 7) % 251),
    );
    await surface.write(written);
    assert.deepEqual(Array.from(await surface.read()), Array.from(written));
    assert.equal(surface.width, 4);
    assert.equal(surface.height, 2);
  });

  it("sizes a decoded photo from the image, not from the caller", async () => {
    const { host, made } = harness();
    const surface = await host.decode(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    assert.deepEqual(
      made,
      [[1200, 800]],
      "a re-encode at a size the browser chose would resize the tipster's photo",
    );
    assert.equal(surface.width, 1200);
  });

  it("passes the quality it was asked for straight to the browser's encoder", async () => {
    const seen: [EncodeKind, number | undefined][] = [];
    const { host } = harness((kind, quality) => seen.push([kind, quality]));
    const surface = host.surface(2, 2);
    // 0.85 is `JPEG_QUALITY` in `packages/clean`, on the canvas scale. A host that divided, rounded or
    // re-scaled it here is the difference between a legible page and a mushy one, quietly.
    await surface.encode("jpeg", 0.85);
    await surface.encode("png", undefined);
    assert.deepEqual(seen, [
      ["jpeg", 0.85],
      ["png", undefined],
    ]);
  });

  it("encodes through the host it was given, so a test can watch the bytes leave", async () => {
    const { host } = harness(() => {});
    assert.deepEqual(Array.from(await host.surface(3, 1).encode("png")), [1, 3]);
  });

  it("stops when the browser refuses a context instead of cleaning against nothing", () => {
    const host = domCanvasHost({
      createCanvas: (width, height) => new FakeCanvas(width, height, true),
      setupPdfWorker: () => {},
    });
    assert.throws(() => host.surface(10, 10), /refused a 2d canvas context/);
  });

  it("refuses a size that is not a whole number of pixels before making anything", () => {
    const { host, made } = harness();
    for (const bad of [0, -4, 1.5, Number.NaN]) {
      assert.throws(() => host.surface(bad, 8), RangeError, `${bad} is not a canvas width`);
      assert.throws(() => host.surface(8, bad), RangeError, `${bad} is not a canvas height`);
    }
    assert.deepEqual(made, [], "a canvas made for a size nobody will use is a leak, not a no-op");
  });

  it("configures the pdf worker once, however many documents are opened", () => {
    let setups = 0;
    const host = domCanvasHost({
      createCanvas: (width, height) => new FakeCanvas(width, height),
      setupPdfWorker: () => {
        setups += 1;
      },
    });
    host.pdfOptions();
    host.pdfOptions();
    host.pdfOptions();
    assert.equal(setups, 1, "a second worker for the same tip costs the tipster a thread");
    assert.deepEqual(host.pdfOptions(), {}, "a browser's pdfjs needs no options from us");
  });
});
