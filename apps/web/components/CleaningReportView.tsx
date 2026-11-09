// What was removed from each file (S-10.4)
export interface CleaningReportViewProps {
  report: {
    files: { name: string; removed: string[]; scanMode?: boolean; pages?: number }[];
    warnings: string[];
  };
}

export function CleaningReportView({ report }: CleaningReportViewProps) {
  if (report.files.length === 0 && report.warnings.length === 0) return null;

  return (
    <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4 text-emerald-200 text-sm">
      <div className="mb-2 font-semibold text-emerald-300">Cleaning Report</div>
      {report.warnings.map((w, i) => (
        <div key={i} className="mb-2 text-xs text-amber-400 bg-amber-950/30 p-2 rounded border border-amber-800/30">
          ⚠️ {w}
        </div>
      ))}
      <div className="space-y-2">
        {report.files.map((file, i) => (
          <div key={i} className="rounded bg-black/40 p-2 border border-emerald-900/30">
            <div className="font-mono text-xs text-emerald-400 font-medium">
              {file.name} {file.pages ? `(${file.pages} pages)` : ""}
            </div>
            {file.removed.length > 0 ? (
              <div className="mt-1 text-xs text-neutral-300">
                <span className="text-emerald-500">Stripped metadata: </span>
                {file.removed.join(", ")}
              </div>
            ) : (
              <div className="mt-1 text-xs text-neutral-400">No metadata tags found.</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
