// Type gate: only PDF, JPEG, PNG. Everything else is REFUSED (privacy invariant 4) (S-6.7).
export const SUPPORTED = ["application/pdf", "image/jpeg", "image/png"] as const;
export type Supported = (typeof SUPPORTED)[number];

export const sniffType = async (_file: Blob): Promise<Supported | "refused"> => {
  throw new Error("not implemented: S-6.7 (sniff magic bytes, not the extension)");
};
export const REFUSAL_MESSAGE = "This file type isn't supported. Export it as PDF and try again.";
