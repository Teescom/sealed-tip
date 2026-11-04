// Decode → canvas → re-encode (drops EXIF/XMP/IPTC) (S-6.9).
export const reencodeImage = async (_file: Blob): Promise<Blob> => {
  throw new Error("not implemented: S-6.9");
};
