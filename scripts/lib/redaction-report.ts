// What a stored redaction bundle proves, in one function the CLI can print and a test can assert on (S-8.5).
//
// This is the verifier PRD F5 points at: an outside party with a file and the nonce they chose gets the same
// answer the tipster's client gets. It lives here rather than inside `verifyRedactionBundle` because the
// dstack chain (lib/app-cert) is a script-side concern that needs a CA pin, and the output format — checks,
// then one hash, then what was not checked — is the thing a judge reads.
import {
  attestationHashOf,
  verifyRedactionBundle,
  type Check,
  type RedactionBundle,
} from "@sealedtip/crypto";

export interface RedactionReport {
  readonly checks: readonly Check[];
  /** What this bundle still cannot prove, in the crypto package's own words. */
  readonly unchecked: readonly string[];
  /** The value a panel, a receipt, or a later issue thread quotes. */
  readonly hash: string;
  readonly failed: number;
}

/**
 * `extra` is for checks the caller contributes — the app-cert chain, whose root pin is a per-deployment
 * decision and so belongs to whoever ran the command, not to the bundle format.
 */
export const redactionReport = (
  bundle: RedactionBundle,
  nonce: string,
  extra: readonly Check[] = [],
): RedactionReport => {
  const result = verifyRedactionBundle(bundle, nonce);
  const checks = [...result.checks, ...extra];
  return {
    checks,
    unchecked: result.unchecked,
    hash: attestationHashOf(bundle),
    failed: checks.filter((entry) => !entry.ok).length,
  };
};

/** The lines the CLI writes: every verdict, the hash, then the gaps, in that order. */
export const redactionReportLines = (report: RedactionReport): string[] => [
  ...report.checks.map((entry) => `${entry.ok ? "✔" : "✘"} ${entry.name} — ${entry.detail}`),
  "",
  `attestation_hash ${report.hash}`,
  "",
  `Not proven by this bundle (${report.unchecked.length}):`,
  ...report.unchecked.map((gap) => `  · ${gap}`),
];
