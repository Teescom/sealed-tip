"use client";

import React, { useState } from "react";

const h = React.createElement;

// Show 24 words once, with save-offline warning (S-10.4, S-10.9)
export interface RecoveryWordsProps {
  words: string[];
}

export function RecoveryWords({ words }: RecoveryWordsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(words.join(" "));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return h(
    "section",
    {
      "aria-labelledby": "recovery-words-title",
      className: "card-inset space-y-4 p-4 sm:p-5",
    },
    h(
      "div",
      { className: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" },
      h(
        "div",
        { className: "space-y-1" },
        h("h2", { id: "recovery-words-title", className: "text-base font-semibold text-ink" }, "Your 24 recovery words"),
        h(
          "p",
          { className: "text-xs leading-relaxed text-ink-muted" },
          "There is no account and no email to recover. These words are the only way back into this tip: status, check-ins and the claim all come from them.",
        ),
      ),
      h(
        "button",
        {
          type: "button",
          onClick: handleCopy,
          "aria-label": "Copy all 24 recovery words to clipboard",
          className:
            "btn-primary min-h-[44px] shrink-0 px-4 text-sm disabled:cursor-not-allowed",
        },
        copied ? "Copied" : "Copy all 24 words",
      ),
    ),
    h(
      "p",
      { className: "border-l-4 border-l-warn bg-paper py-2 pl-3 pr-2 text-xs text-ink" },
      "Write them down on paper before anything else. A screenshot lives on a device that can be taken from you.",
    ),
    h(
      "ol",
      { className: "grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4" },
      words.map((w, i) =>
        h(
          "li",
          { key: i, className: "flex min-h-[40px] items-baseline gap-2 border-b border-rule py-1.5 text-sm" },
          h("span", { className: "datum w-6 shrink-0 text-right text-xs text-ink-muted select-none" }, `${i + 1}`),
          h("span", { className: "datum text-ink select-all" }, w),
        ),
      ),
    ),
  );
}
