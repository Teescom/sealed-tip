// Optional scan mode: grayscale + threshold to suppress printer tracking dots. Mitigation, not a guarantee (S-6.10).
export const scanMode = async (_image: Blob): Promise<Blob> => {
  throw new Error("not implemented: S-6.10");
};
