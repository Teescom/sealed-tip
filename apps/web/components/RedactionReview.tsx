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
      className: "card-inset space-y-4 p-4 sm:p-5",
    },
    h(
      "div",
      { className: "flex flex-wrap items-baseline justify-between gap-2" },
      h("h2", { id: "ai-redaction-title", className: "text-base font-semibold text-ink" }, "AI redaction suggestions"),
      h(
        "span",
        { className: "datum text-xs text-ink-muted" },
        `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}`,
      ),
    ),
    h(
      "p",
      { className: "text-xs leading-relaxed text-ink-muted" },
      "The enclave ran inside confidential computing and returned these spans. Nothing it flags leaves the tip until you accept it, and it misses things: read your own text too.",
    ),
    h(
      "ul",
      { className: "divide-y divide-rule" },
      suggestions.map((s, idx) =>
        h(
          "li",
          { key: idx, className: "space-y-2 py-3" },
          h(
            "div",
            { className: "flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" },
            h("span", { className: "datum break-all text-ink-muted line-through" }, `"${s.span}"`),
            h("span", { className: "datum break-all font-semibold text-ink", "aria-label": "Replacement" }, s.replacement),
          ),
          h("p", { className: "text-xs text-ink-muted" }, s.reason),
          (onAccept || onReject) &&
            h(
              "div",
              { className: "flex flex-col gap-2 sm:flex-row sm:justify-end" },
              onReject &&
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => onReject(idx),
                    "aria-label": `Keep original text "${s.span}" and discard suggestion`,
                    className: "btn-secondary min-h-[44px] px-3.5 text-xs",
                  },
                  "Keep the original",
                ),
              onAccept &&
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => onAccept(idx),
                    "aria-label": `Accept replacement "${s.replacement}" for "${s.span}"`,
                    className: "btn-primary min-h-[44px] px-4 text-xs",
                  },
                  "Accept the replacement",
                ),
            ),
        ),
      ),
    ),
  );
}
