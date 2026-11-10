import React from "react";

const h = React.createElement;

// Dead man's switch; raw opt-in with warning (S-10.4, S-10.9)
export interface SwitchSettingsProps {
  value: { interval: string; grace: string; includesRaw: boolean };
  onChange?: (v: { interval: string; grace: string; includesRaw: boolean }) => void;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
}

const FIELD = "w-full min-h-[44px] rounded-field border border-edge bg-paper px-3 py-2 text-sm text-ink font-mono";

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
      className: "card-inset space-y-4 p-4 sm:p-5",
    },
    h(
      "div",
      { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" },
      h(
        "div",
        null,
        h("h2", { id: "switch-heading", className: "text-base font-semibold text-ink" }, "Dead man's switch"),
        h("p", { className: "text-xs text-ink-muted" }, enabled ? "Armed" : "Not armed"),
      ),
      onToggle &&
        h(
          "button",
          {
            type: "button",
            onClick: () => onToggle(!enabled),
            "aria-pressed": enabled,
            "aria-label": `Toggle dead man's switch. Currently ${enabled ? "armed" : "disabled"}`,
            className: `${enabled ? "btn-primary" : "btn-secondary"} min-h-[44px] shrink-0 px-4 text-sm`,
          },
          enabled ? "Armed — tap to stand down" : "Enable the switch",
        ),
    ),
    h(
      "p",
      { className: "text-xs leading-relaxed text-ink-muted" },
      "If you stop checking in, the switch triggers at your deadline plus the grace period and the keeper releases the decryption keys to the panel members who were not recused. Nothing happens until then.",
    ),
    enabled &&
      onChange &&
      h(
        "div",
        { className: "space-y-4 border-t border-rule pt-4" },
        h(
          "div",
          { className: "grid grid-cols-1 gap-3 text-xs sm:grid-cols-2" },
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "checkin-interval", className: "mb-1 block font-medium text-ink-muted" },
              "Check in every (days)",
            ),
            h("input", {
              id: "checkin-interval",
              type: "number",
              min: "1",
              value: value.interval,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                onChange({ ...value, interval: e.target.value }),
              className: FIELD,
            }),
          ),
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "grace-period", className: "mb-1 block font-medium text-ink-muted" },
              "Grace period (days)",
            ),
            h("input", {
              id: "grace-period",
              type: "number",
              min: "0",
              value: value.grace,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                onChange({ ...value, grace: e.target.value }),
              className: FIELD,
            }),
          ),
        ),
        h(
          "label",
          {
            className:
              "flex min-h-[44px] cursor-pointer items-start gap-3 border-l-4 border-l-warn bg-paper p-3",
          },
          h("input", {
            type: "checkbox",
            id: "raw-opt-in",
            checked: value.includesRaw,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, includesRaw: e.target.checked }),
            className: "mt-1 h-4 w-4 shrink-0 rounded-inset border-edge",
          }),
          h(
            "div",
            { className: "space-y-1 text-xs" },
            h("span", { className: "block font-medium text-ink" }, "Send the raw originals too"),
            h(
              "p",
              { className: "leading-normal text-ink-muted" },
              "The cleaned copy is what the panel normally sees. Opting in also hands them the unsanitised files, metadata and all, including whatever they still reveal about you.",
            ),
          ),
        ),
      ),
  );
}
