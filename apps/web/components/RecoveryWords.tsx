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
      className: "rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 sm:p-5 text-amber-200",
    },
    h(
      "div",
      { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3" },
      h(
        "div",
        null,
        h("h2", { id: "recovery-words-title", className: "font-semibold text-amber-300 text-sm sm:text-base" }, "Recovery Words (Save Offline Now)"),
        h("p", { className: "text-xs text-amber-400/90 mt-0.5" }, "You have no account. These 24 words are your ONLY key to check status, check in, and claim rewards."),
      ),
      h(
        "button",
        {
          type: "button",
          onClick: handleCopy,
          "aria-label": "Copy all 24 recovery words to clipboard",
          className:
            "min-h-[44px] px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-semibold transition-colors flex items-center justify-center shrink-0 cursor-pointer",
        },
        copied ? "✓ Words Copied!" : "📋 Copy All Words",
      ),
    ),
    h(
      "div",
      { className: "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 font-mono text-xs sm:text-sm" },
      words.map((w, i) =>
        h(
          "div",
          {
            key: i,
            className:
              "min-h-[40px] rounded-lg bg-black/50 px-2.5 py-2 flex items-center justify-center text-center border border-amber-800/30",
          },
          h("span", { className: "text-amber-500 text-xs mr-1.5 select-none font-semibold" }, `${i + 1}.`),
          h("span", { className: "text-amber-100 select-all" }, w),
        ),
      ),
    ),
  );
}
