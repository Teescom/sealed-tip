import React from "react";

const h = React.createElement;

// Dead man's switch; raw opt-in with warning (S-10.4, S-10.9)
export interface SwitchSettingsProps {
  value: { interval: string; grace: string; includesRaw: boolean };
  onChange?: (v: { interval: string; grace: string; includesRaw: boolean }) => void;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
}

export function SwitchSettings({
  value,
  onChange,
  enabled = false,
  onToggle,
}: SwitchSettingsProps) {
  return h(
    "section",
    {
      "aria-labelledby": "switch-heading",
      className: "rounded-xl border border-neutral-700 bg-neutral-900/50 p-4 sm:p-5",
    },
    h(
      "div",
      { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2" },
      h(
        "div",
        null,
        h("h2", { id: "switch-heading", className: "font-semibold text-neutral-200 text-sm sm:text-base" }, "Dead Man's Switch"),
        h(
          "span",
          { className: "text-xs text-neutral-400 font-mono" },
          enabled ? "Status: Armed" : "Status: Disabled (Default)",
        ),
      ),
      onToggle &&
        h(
          "button",
          {
            type: "button",
            onClick: () => onToggle(!enabled),
            "aria-pressed": enabled,
            "aria-label": `Toggle dead man's switch. Currently ${enabled ? "armed" : "disabled"}`,
            className: `min-h-[44px] min-w-[100px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
              enabled
                ? "bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-950/40"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700"
            }`,
          },
          enabled ? "✓ Armed" : "+ Enable Switch",
        ),
    ),
    h(
      "p",
      { className: "text-xs text-neutral-400 leading-relaxed mb-3" },
      "If you fail to check in within the configured interval plus grace period, the switch triggers and the keeper automatically releases the exhibit decryption keys to non-recused panel members.",
    ),
    enabled &&
      onChange &&
      h(
        "div",
        { className: "space-y-4 pt-3 border-t border-neutral-800" },
        h(
          "div",
          { className: "grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs" },
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "checkin-interval", className: "block text-neutral-300 font-medium mb-1.5" },
              "Check-in Interval (days)",
            ),
            h("input", {
              id: "checkin-interval",
              type: "number",
              min: "1",
              value: value.interval,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                onChange({ ...value, interval: e.target.value }),
              className:
                "w-full min-h-[44px] bg-black/50 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 font-mono",
            }),
          ),
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "grace-period", className: "block text-neutral-300 font-medium mb-1.5" },
              "Grace Period (days)",
            ),
            h("input", {
              id: "grace-period",
              type: "number",
              min: "0",
              value: value.grace,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                onChange({ ...value, grace: e.target.value }),
              className:
                "w-full min-h-[44px] bg-black/50 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 font-mono",
            }),
          ),
        ),
        h(
          "label",
          {
            className:
              "min-h-[44px] flex items-start gap-3 p-3 rounded-lg border border-amber-900/30 bg-amber-950/10 cursor-pointer transition-colors hover:bg-amber-950/20",
          },
          h("input", {
            type: "checkbox",
            id: "raw-opt-in",
            checked: value.includesRaw,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, includesRaw: e.target.checked }),
            className:
              "mt-1 w-4 h-4 rounded border-neutral-700 text-amber-500 focus:ring-amber-500 cursor-pointer",
          }),
          h(
            "div",
            { className: "text-xs text-neutral-300 space-y-1" },
            h("span", { className: "font-medium text-amber-200 block" }, "Include uncleaned raw originals in exhibit"),
            h(
              "p",
              { className: "text-amber-400/90 text-[11px] leading-normal" },
              "⚠️ Warning: Raw originals contain unstripped metadata. Opting in provides these files to the panel during triage as well.",
            ),
          ),
        ),
      ),
  );
}
