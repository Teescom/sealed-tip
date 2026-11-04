// Rasterise every page (pdfjs) → rebuild a new PDF from images (pdf-lib). Kills incremental updates,
// metadata, fonts and embedded-image EXIF (S-6.8).
export const rasterisePdf = async (_file: Blob, _opts?: { dpi?: number }): Promise<Blob> => {
  throw new Error("not implemented: S-6.8");
};
