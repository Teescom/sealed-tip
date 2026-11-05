// The dstack X.509 chain that NEAR AI Cloud ships inside `info.app_cert` (S-0.3).
// Node-only by design: `packages/crypto` has to stay browser-safe, so nothing here uses node:crypto.
// Offsets and shapes were measured against live `GET /v1/attestation/report` responses.
import { X509Certificate } from "node:crypto";

import { fromHex, quoteRegisters, type Check } from "@sealedtip/crypto";

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

export interface AppCertOptions {
  /** sha256 of the compose manifest the party also states in the report. */
  composeHash?: string;
  /** sha256 fingerprints we decided to trust ahead of time; empty means nothing is pinned. */
  pinnedRoots?: string[];
  now?: Date;
}

const check = (name: string, ok: boolean, detail: string): Check => ({ name, ok, detail });

const normalizeFingerprint = (value: string): string => value.split(":").join("").toLowerCase();

/** Node separates RDNs with newlines, so a CN containing spaces stays intact. */
const commonName = (distinguished: string): string => {
  const names = distinguished.split("\n").filter((line) => line.startsWith("CN="));
  return names.at(-1)?.slice(3) ?? distinguished;
};

const contains = (haystack: Uint8Array, needle: string): number =>
  Buffer.from(haystack).indexOf(Buffer.from(fromHex(needle)));

export const appCertChain = (appCert: string): X509Certificate[] =>
  (appCert.match(PEM_BLOCK) ?? []).map((block) => new X509Certificate(block));

/** The self-signed tail of the chain — what a verifier has to pin, since every VM mints its own. */
export const appCertRoots = (appCert: string): string[] => {
  try {
    return appCertChain(appCert)
      .filter((cert) => cert.subject === cert.issuer)
      .map((cert) => cert.fingerprint256);
  } catch {
    return [];
  }
};

export const verifyAppCertChain = (
  label: string,
  appCert: string,
  intelQuoteHex: string,
  options: AppCertOptions = {},
): Check[] => {
  const checks: Check[] = [];
  const add = (suffix: string, ok: boolean, detail: string): void => {
    checks.push(check(`${label}.${suffix}`, ok, detail));
  };

  let chain: X509Certificate[];
  try {
    chain = appCertChain(appCert);
  } catch (error) {
    add("app_cert_parses", false, String(error));
    return checks;
  }
  if (chain.length < 2) {
    add("app_cert_parses", false, `${chain.length} PEM block(s); need a leaf and at least one CA`);
    return checks;
  }
  add(
    "app_cert_parses",
    true,
    `${chain.length} certificates: ${chain.map((cert) => commonName(cert.subject)).join(" ← ")}`,
  );

  const leaf = chain[0]!;
  const root = chain.at(-1)!;

  let chainLinks = true;
  const signatures: string[] = [];
  for (let index = 0; index < chain.length; index++) {
    const cert = chain[index]!;
    const issuer = chain[index + 1] ?? cert;
    if (cert.issuer !== issuer.subject) chainLinks = false;
    // the leaf must be an end entity and everything above it a CA
    if (index === 0 ? cert.ca : !cert.ca) chainLinks = false;
    const verified = cert.verify(issuer.publicKey);
    if (!verified) chainLinks = false;
    signatures.push(`${commonName(cert.subject)}${verified ? "✓" : "✗"}`);
  }
  add(
    "app_cert_chain_signs_through",
    chainLinks,
    `${signatures.join(" → ")}; root self-signed ${root.subject === root.issuer}, leaf is ${leaf.ca ? "a CA" : "an end entity"}`,
  );

  const now = options.now ?? new Date();
  const windows = chain.map((cert) => ({ from: new Date(cert.validFrom), to: new Date(cert.validTo) }));
  add(
    "app_cert_chain_is_current",
    windows.every(({ from, to }) => from <= now && now <= to),
    `leaf expires ${windows[0]!.to.toISOString()}`,
  );

  // The leaf is CA-signed and carries the same five registers the hardware signed into the quote.
  // That is what covers RTMR3, which the event log provably cannot replay.
  let registers: { mrtd: string; rtmr: string[] };
  try {
    registers = quoteRegisters(intelQuoteHex);
  } catch (error) {
    add("app_cert_binds_the_quote", false, String(error));
    return checks;
  }
  const measured: [string, string][] = [
    ["mrtd", registers.mrtd],
    ...registers.rtmr.map((value, index): [string, string] => [`rtmr${index}`, value]),
  ];
  const offsets = measured.map(([name, value]) => [name, contains(leaf.raw, value)] as const);
  add(
    "app_cert_binds_the_quote",
    offsets.every(([, offset]) => offset >= 0),
    offsets.map(([name, offset]) => `${name}@${offset}`).join(" "),
  );

  if (options.composeHash !== undefined) {
    const composeOffset = contains(leaf.raw, options.composeHash);
    add(
      "app_cert_binds_the_compose_hash",
      composeOffset >= 0,
      `sha256(manifest) ${options.composeHash.slice(0, 16)}… at leaf offset ${composeOffset}`,
    );
  }

  const pinned = (options.pinnedRoots ?? []).map(normalizeFingerprint);
  if (pinned.length > 0) {
    add(
      "app_cert_root_is_pinned",
      pinned.includes(normalizeFingerprint(root.fingerprint256)),
      `root ${root.fingerprint256} vs ${pinned.length} pinned fingerprint(s)`,
    );
  }
  return checks;
};
