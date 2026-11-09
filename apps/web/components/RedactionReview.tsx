import React from "react";

const h = React.createElement;

// Accept/edit AI redaction suggestions (S-10.4, S-10.9)
export interface RedactionReviewProps {
  suggestions: { span: string; reason: string; replacement: string }[];
  onAccept?: (idx: number) => void;
  onReject?: (idx: number) => void;
}

export function RedactionReview({ suggestions, onAccept, onReject }: RedactionReviewProps) {
  if (suggestions.length === 0) return null;

  return h(
    "section",
    {
      "aria-labelledby": "ai-redaction-title",
      className: "rounded-xl border border-purple-800/40 bg-purple-950/20 p-4 sm:p-5 text-purple-200 text-sm",
    },
    h(
      "div",
      { className: "flex items-center justify-between mb-1" },
      h("h2", { id: "ai-redaction-title", className: "font-semibold text-purple-300 text-sm sm:text-base" }, "AI Redaction Suggestions"),
      h("span", { className: "text-xs font-mono text-purple-400" }, `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}`),
    ),
    h(
      "p",
      { className: "mb-3 text-xs text-purple-300/80 leading-relaxed" },
      "Review flagged identity-revealing phrases identified by the verifiable NEAR AI TEE enclave.",
    ),
    h(
      "div",
      { className: "space-y-3" },
      suggestions.map((s, idx) =>
        h(
          "div",
          { key: idx, className: "rounded-lg bg-black/50 p-3 border border-purple-900/40 text-xs space-y-2" },
          h(
            "div",
            { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-1.5" },
            h("span", { className: "text-red-400 font-mono line-through break-all" }, `"${s.span}"`),
            h("span", { className: "text-emerald-400 font-mono font-medium break-all" }, `→ "${s.replacement}"`),
          ),
          h("p", { className: "text-neutral-400 text-[11px] italic leading-normal" }, s.reason),
          (onAccept || onReject) &&
            h(
              "div",
              { className: "pt-2 flex flex-col sm:flex-row gap-2 sm:justify-end border-t border-purple-900/30" },
              onReject &&
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => onReject(idx),
                    "aria-label": `Keep original text "${s.span}" and discard suggestion`,
                    className:
                      "min-h-[44px] px-3.5 py-2 bg-neutral-800 text-neutral-200 rounded-lg hover:bg-neutral-700 text-xs font-medium transition-colors flex items-center justify-center cursor-pointer border border-neutral-700",
                  },
                  "Keep Original",
                ),
              onAccept &&
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => onAccept(idx),
                    "aria-label": `Accept replacement "${s.replacement}" for "${s.span}"`,
                    className:
                      "min-h-[44px] px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 text-xs font-semibold transition-colors flex items-center justify-center cursor-pointer shadow-sm",
                  },
                  "✓ Accept Replacement",
                ),
            ),
        ),
      ),
    ),
  );
}
