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
      className: "rounded-xl border border-neutral-700 bg-neutral-900/50 p-4 sm:p-5",
    },
    h(
      "div",
      { className: "flex items-center justify-between mb-1" },
      h("h2", { id: "recusal-heading", className: "font-semibold text-neutral-200 text-sm sm:text-base" }, "Panel Recusal"),
      h("span", { className: "text-xs font-mono text-neutral-400" }, `${panel.length - value.length} active / ${panel.length} total`),
    ),
    h(
      "p",
      { className: "mb-3 text-xs text-neutral-400 leading-relaxed" },
      "Exclude panel members with conflicts of interest. Recused members receive no encryption keys. Per Invariant 6, at least 2 non-recused members must remain.",
    ),
    errorMsg &&
      h(
        "div",
        {
          role: "alert",
          "aria-live": "polite",
          className: "mb-3 p-3 rounded-lg border border-red-500/50 bg-red-950/40 text-red-300 text-xs flex items-center gap-2",
        },
        h("span", { "aria-hidden": "true" }, "⚠️"),
        h("span", null, errorMsg),
      ),
    h(
      "div",
      { className: "space-y-2" },
      panel.map((member) => {
        const isRecused = value.includes(member);
        return h(
          "div",
          {
            key: member,
            className: `flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border text-sm transition-colors ${
              isRecused
                ? "border-red-800/60 bg-red-950/30 text-red-200"
                : "border-neutral-800 bg-neutral-950/40 text-neutral-300"
            }`,
          },
          h(
            "div",
            { className: "flex items-center gap-2" },
            h("span", { className: `w-2 h-2 rounded-full ${isRecused ? "bg-red-400" : "bg-emerald-400"}`, "aria-hidden": "true" }),
            h("span", { className: "font-mono text-xs sm:text-sm break-all" }, member),
          ),
          h(
            "button",
            {
              type: "button",
              onClick: () => toggle(member),
              "aria-pressed": isRecused,
              "aria-label": `Toggle recusal for panel member ${member}. Currently ${isRecused ? "recused" : "active"}`,
              className: `min-h-[44px] min-w-[120px] px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                isRecused
                  ? "bg-red-800/50 text-red-200 hover:bg-red-800/80 border border-red-600/50"
                  : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border border-neutral-700"
              }`,
            },
            isRecused ? "✕ Recused (Excluded)" : "✓ Active Member",
          ),
        );
      }),
    ),
  );
}
