// Re-verify a stored NEAR AI Cloud attestation bundle offline (S-0.3, S-8.5).
// Usage: pnpm verify-attestation -- --fetch <model> | --bundle <file> --nonce <hex32>
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { verifyAttestationBundle, type AttestationBundle } from "@sealedtip/crypto";

const CLOUD_API = "https://cloud-api.near.ai";
const DEFAULT_BUNDLE = "../fixtures/attestation.json";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const hex32 = (): string => randomBytes(32).toString("hex");

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
  for (const entry of result.checks) {
    console.log(`${entry.ok ? "✔" : "✘"} ${entry.name} — ${entry.detail}`);
  }
  console.log(result.ok ? "\nbindings verified." : `\nFAILED: ${result.checks.filter((c) => !c.ok).length} checks.`);
  console.log(
    "\nNot covered here (each needs a dependency call, see ROADMAP S-0.3):\n" +
      "  · the Intel signature chain over the quote (DCAP collateral) — proves the quote is genuine hardware\n" +
      "  · the GPU (NVIDIA NRAS) and Sigstore provenance checks\n" +
      "  · the response signature from GET /v1/signature/<chatId>, which needs NEAR_AI_API_KEY",
  );
  return result.ok ? 0 : 1;
};

process.exitCode = await run();
