// Re-verify a stored NEAR AI Cloud attestation bundle offline (S-0.3, S-8.5).
// Usage: pnpm verify-attestation -- --fetch <model> | --bundle <file> --nonce <hex32> [--pin-ca <sha256 fp>]
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { verifyAttestationBundle, type AttestationBundle, type AttestedParty } from "@sealedtip/crypto";

import { appCertRoots, verifyAppCertChain } from "./lib/app-cert.js";

const CLOUD_API = "https://cloud-api.near.ai";
const DEFAULT_BUNDLE = "../fixtures/attestation.json";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const hex32 = (): string => randomBytes(32).toString("hex");

/** dstack gives every VM its own KMS root, so a pin is a per-deployment decision, not a vendor constant. */
const pinnedRoots = (arg("pin-ca") ?? "").split(/[,\s]+/).filter((value) => value.length > 0);

const appCertChecks = (bundle: AttestationBundle): { checks: ReturnType<typeof verifyAppCertChain>; unpinned: string[] } => {
  const parties: [string, AttestedParty][] = [
    ...(bundle.gateway_attestation ? [["gateway", bundle.gateway_attestation] as [string, AttestedParty]] : []),
    ...bundle.model_attestations.map(
      (party, index): [string, AttestedParty] => [party.model_name ?? `model${index}`, party],
    ),
  ];
  const checks: ReturnType<typeof verifyAppCertChain> = [];
  const unpinned: string[] = [];
  for (const [label, party] of parties) {
    const appCert = party.info?.app_cert;
    if (appCert === undefined) {
      checks.push({ name: `${label}.app_cert_present`, ok: false, detail: "the report carries no info.app_cert" });
      continue;
    }
    const composeHash = party.info?.tcb_info?.compose_hash ?? party.info?.compose_hash;
    checks.push(
      ...verifyAppCertChain(label, appCert, party.intel_quote, {
        ...(composeHash === undefined ? {} : { composeHash }),
        pinnedRoots,
      }),
    );
    if (pinnedRoots.length === 0) unpinned.push(`${label}: ${appCertRoots(appCert).join(", ")}`);
  }
  return { checks, unpinned };
};

const fetchBundle = async (model: string, nonce: string): Promise<AttestationBundle> => {
  const url =
    `${CLOUD_API}/v1/attestation/report?model=${encodeURIComponent(model)}` +
    `&nonce=${nonce}&signing_algo=ecdsa`;
  const response = await fetch(url, { headers: { "x-no-aliasing": "true" } });
  if (!response.ok) {
    throw new Error(`GET ${url} → HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return (await response.json()) as AttestationBundle;
};

const run = async (): Promise<number> => {
  const bundlePath = arg("bundle") ?? DEFAULT_BUNDLE;
  let nonce = arg("nonce");
  let bundle: AttestationBundle;

  const model = arg("fetch");
  if (model !== undefined) {
    nonce = nonce ?? hex32();
    console.log(`fetching an attestation report for ${model} (nonce ${nonce})`);
    bundle = await fetchBundle(model, nonce);
    writeFileSync(fileURLToPath(new URL(bundlePath, import.meta.url)), JSON.stringify(bundle));
    console.log(`saved to ${bundlePath}`);
  } else {
    const file = fileURLToPath(new URL(bundlePath, import.meta.url));
    bundle = JSON.parse(readFileSync(file, "utf8")) as AttestationBundle;
    if (nonce === undefined) {
      console.error(
        "--nonce is required: it is the value only you chose, and binding it into the quote is the whole check.\n" +
          "Re-run with --fetch <model> to get a report for a fresh nonce.",
      );
      return 2;
    }
  }

  const result = verifyAttestationBundle(bundle, nonce);
  const { checks: certChecks, unpinned } = appCertChecks(bundle);
  const checks = [...result.checks, ...certChecks];
  for (const entry of checks) {
    console.log(`${entry.ok ? "✔" : "✘"} ${entry.name} — ${entry.detail}`);
  }
  const failed = checks.filter((entry) => !entry.ok).length;
  console.log(failed === 0 ? "\nbindings verified." : `\nFAILED: ${failed} checks.`);
  console.log(
    "\nNot covered here (each needs a dependency call, see ROADMAP S-0.3):\n" +
      "  · the Intel signature chain over the quote (DCAP collateral) — proves the quote is genuine hardware\n" +
      "  · the GPU (NVIDIA NRAS) and Sigstore provenance checks\n" +
      "  · the response signature from GET /v1/signature/<chatId>, which needs NEAR_AI_API_KEY" +
      (pinnedRoots.length > 0
        ? `\n\nRoots pinned: ${pinnedRoots.join(", ")}`
        : `\n\nThe dstack chain above is internally consistent but unanchored — nobody but the VM's own KMS CA signs it.` +
          `\nPin a root once you have seen it through a channel you trust: --pin-ca <sha256 fingerprint>\n  ${unpinned.join("\n  ")}`),
  );
  return failed === 0 ? 0 : 1;
};

process.exitCode = await run();
