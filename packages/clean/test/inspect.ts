// Reading helpers for the cleaning tests: fixtures off disk, pixels out of an image, and text out of bytes.
import { readFile } from "node:fs/promises";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import exifr from "exifr";

const fixturesDir = new URL("../../../fixtures/files/", import.meta.url).pathname;

export const fixtureBytes = (name: string): Promise<Uint8Array> => readFile(`${fixturesDir}${name}`);

export const fixtureBlob = async (name: string): Promise<Blob> => new Blob([await fixtureBytes(name)]);

/** The fixtures are fictional, and this is the file that says so: nothing here may look like real evidence. */
export const FICTIONAL_VALUES = [
  "J. Okafor",
  "Okafor",
  "Acme Invoice Engine",
  "Acme Ledger Export",
  "Fictiophone",
  "FictiCamera",
  "6.5244",
  "3.3792",
  "NGN 2,400,000",
] as const;

/**
 * What exifr reports about a container rather than about the file inside it. A re-encoded image still
 * legitimately has these, so a test that demanded they were gone would be testing the wrong thing — and
 * any name outside this list must not survive cleaning. Deliberately a second list and not the one in
 * `src/report.ts`: which names are exempt is that file's decision, and a test that imports it cannot
 * catch the day it exempts something it should not have.
 */
const GEOMETRY = new Set([
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

/** The tags an image still reports, with the container geometry left out. */
export const imageTags = async (bytes: Uint8Array): Promise<string[]> => {
  const parsed = await exifr.parse(bytes);
  return parsed ? Object.keys(parsed).filter((key) => !GEOMETRY.has(key)).sort() : [];
};

const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

export const carriesText = (bytes: Uint8Array, text: string): boolean => latin1(bytes).includes(text);

export const carriesAnyFictionalValue = (bytes: Uint8Array): string[] =>
  FICTIONAL_VALUES.filter((value) => carriesText(bytes, value));

export interface Tally {
  /** Pixels a printer stamp dot would show up as: high red and green, visibly bluer than both is absent. */
  dots: number;
  /** Ink a human reads: dark in all three channels. */
  ink: number;
  total: number;
}

/** Count dot-coloured and ink pixels in a PNG or JPEG. */
export const tallyPixels = async (bytes: Uint8Array): Promise<Tally> => {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let dots = 0;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (r > 200 && g > 200 && r - b > 40 && g - b > 40) dots++;
    if (r < 128 && g < 128 && b < 128) ink++;
  }
  return { dots, ink, total: image.width * image.height };
};
