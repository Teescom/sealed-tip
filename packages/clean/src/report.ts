// What was removed, per file — shown to the tipster; hashed into cleaning_report_hash. Contains no PII (S-6.11).
export interface CleaningReport {
  files: { name: string; type: string; pages?: number; removed: string[]; scanMode: boolean }[];
  warnings: string[];
}
export const buildReport = async (_original: Blob, _cleaned: Blob): Promise<CleaningReport["files"][number]> => {
  throw new Error("not implemented: S-6.11 (use exifr to list removed tags)");
};
