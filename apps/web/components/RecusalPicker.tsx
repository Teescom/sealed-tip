"use client";

import React, { useState } from "react";

const h = React.createElement;

// Exclude panel members (≥2 must remain) (S-10.4, S-10.9)
export interface RecusalPickerProps {
  panel: string[];
  value: string[];
  onChange: (v: string[]) => void;
}

export function RecusalPicker({ panel, value, onChange }: RecusalPickerProps) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggle = (member: string) => {
    setErrorMsg(null);
    if (value.includes(member)) {
      onChange(value.filter((m) => m !== member));
    } else {
      if (panel.length - (value.length + 1) < 2) {
        setErrorMsg("At least 2 non-recused panel members must remain to receive the sealed tip.");
        return;
      }
      onChange([...value, member]);
    }
  };

  return h(
    "section",
    {
      "aria-labelledby": "recusal-heading",
      className: "card-inset p-4 sm:p-5",
    },
    h(
      "div",
      { className: "flex items-center justify-between mb-1" },
      h("h2", { id: "recusal-heading", className: "text-base font-semibold text-ink" }, "Panel recusal"),
      h("span", { className: "text-xs font-mono text-ink-muted" }, `${panel.length - value.length} active / ${panel.length} total`),
    ),
    h(
      "p",
      { className: "mb-3 text-xs text-ink-muted leading-relaxed" },
      "Exclude panel members with conflicts of interest. Recused members receive no encryption keys. Per Invariant 6, at least 2 non-recused members must remain.",
    ),
    errorMsg &&
      h(
        "p",
        {
          role: "alert",
          "aria-live": "polite",
          className: "mb-3 border-l-4 border-l-bad bg-paper p-3 text-xs text-bad",
        },
        errorMsg,
      ),
    h(
      "ul",
      { className: "divide-y divide-rule" },
      panel.map((member) => {
        const isRecused = value.includes(member);
        return h(
          "li",
          {
            key: member,
            className: "flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
          },
          h(
            "div",
            { className: "flex min-w-0 flex-1 items-baseline gap-3" },
            h("span", { className: "datum truncate text-sm text-ink" }, member),
            h(
              "span",
              { className: `shrink-0 text-xs ${isRecused ? "text-bad" : "text-ink-muted"}` },
              isRecused ? "Recused — holds no key" : "On the panel",
            ),
          ),
          h(
            "button",
            {
              type: "button",
              onClick: () => toggle(member),
              "aria-pressed": isRecused,
              "aria-label": `Toggle recusal for panel member ${member}. Currently ${isRecused ? "recused" : "active"}`,
              className: `${isRecused ? "btn-secondary" : "btn-primary"} min-h-[44px] shrink-0 px-3.5 text-xs`,
            },
            isRecused ? "Restore this member" : "Recuse",
          ),
        );
      }),
    ),
  );
}
