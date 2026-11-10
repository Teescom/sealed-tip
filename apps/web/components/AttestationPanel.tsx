import React from "react";

const h = React.createElement;

export interface AttestationPanelProps {
  bundleHash: string;
  model?: string | undefined;
  nonce?: string | undefined;
}

/**
 * What this panel may claim is exactly what `packages/crypto/src/attestation.ts` verifies: the bindings that
 * tie the report to the request we made. The secp256k1 signature over the report is checked for what it
 * covers, not that it is valid — that needs `@noble/curves`, still an ask-first dependency (S-0.3 gap b).
 * Saying more than that here would be the one place a tipster could be talked into trusting an enclave.
 */
export function AttestationPanel({ bundleHash, model, nonce }: AttestationPanelProps) {
  return h(
    "section",
    { "aria-labelledby": "attestation-title", className: "card-inset space-y-3 p-4 sm:p-5" },
    h("h2", { id: "attestation-title", className: "text-base font-semibold text-ink" }, "Enclave attestation"),
    h(
      "p",
      { className: "text-xs leading-relaxed text-ink-muted" },
      "The redaction ran in a NEAR AI Cloud confidential-computing enclave. This browser re-checked that the report " +
        "is bound to this request and this model. It does not yet verify the report's signature — that needs a curve " +
        "dependency the project has not approved, so treat the enclave as reviewed, not proven.",
    ),
    h(
      "dl",
      { className: "divide-y divide-rule text-xs" },
      h(
        "div",
        { className: "flex items-baseline justify-between gap-4 py-1.5" },
        h("dt", { className: "shrink-0 text-ink-muted" }, "Bundle hash"),
        h("dd", { className: "datum min-w-0 break-all text-ink" }, bundleHash),
      ),
      model
        ? h(
            "div",
            { className: "flex items-baseline justify-between gap-4 py-1.5" },
            h("dt", { className: "shrink-0 text-ink-muted" }, "Model"),
            h("dd", { className: "datum text-ink" }, model),
          )
        : null,
      nonce
        ? h(
            "div",
            { className: "flex items-baseline justify-between gap-4 py-1.5" },
            h("dt", { className: "shrink-0 text-ink-muted" }, "Nonce"),
            h("dd", { className: "datum text-ink" }, `${nonce.slice(0, 16)}…`),
          )
        : null,
    ),
  );
}
