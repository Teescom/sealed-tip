import React from "react";
import type { BundleReport } from "@sealedtip/core";

const h = React.createElement;

export interface CleaningReportViewProps {
  report: BundleReport;
}

/**
 * The tipster's own record of what was removed, per file, in the words the cleaner chose (S-10.4).
 *
 * Tag names and counts only — `BundleReport` carries no file content, so nothing rendered here can leak an
 * exhibit into a page that is served.
 */
export function CleaningReportView({ report }: CleaningReportViewProps) {
  if (report.files.length === 0 && report.warnings.length === 0) return null;

  return h(
    "section",
    { "aria-labelledby": "cleaning-report-title", className: "card-inset space-y-4 p-4 sm:p-5" },
    h("h2", { id: "cleaning-report-title", className: "text-base font-semibold text-ink" }, "What was taken out"),
    report.warnings.map((w, i) =>
      h("p", { key: i, className: "border-l-4 border-l-warn bg-paper p-3 text-xs text-ink" }, w),
    ),
    h(
      "dl",
      { className: "divide-y divide-rule" },
      report.files.map((file, i) =>
        h(
          "div",
          {
            key: i,
            className:
              "grid grid-cols-1 gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]",
          },
          h(
            "dt",
            { className: "datum min-w-0 break-all text-sm text-ink" },
            file.name,
            file.pages ? h("span", { className: "text-ink-muted" }, ` · ${file.pages} pages`) : null,
            file.scanMode ? h("span", { className: "text-ink-muted" }, " · recomposited scan") : null,
          ),
          h(
            "dd",
            { className: "text-xs text-ink-muted" },
            file.removed.length > 0 ? file.removed.join(", ") : "No metadata tags were present.",
          ),
        ),
      ),
    ),
  );
}
