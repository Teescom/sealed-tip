// NEAR AI Cloud attestation bundle: re-verify offline the bindings that tie a report to the request we made (S-0.3).
// Offsets and field shapes below were measured against live `GET /v1/attestation/report` responses, not recalled from a spec.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import * as ed25519 from "@noble/ed25519";

/** @noble/ed25519 v3 needs the hash injected before any sync call works. */
ed25519.hashes.sha512 = sha512;

export const QUOTE_VERSION_TDX = 4;
export const QUOTE_TYPE_ECDSA_P256 = 2;

const QUOTE_MIN_BYTES = 632;
const REGISTER_BYTES = 48;
const MRTD_OFFSET = 184;
const RTMR0_OFFSET = 376;
const REPORT_DATA_OFFSET = 568;
const ADDRESS_BYTES = 20;
const NONCE_BYTES = 32;

export interface EventLogEntry {
  imr: number;
  digest: string;
}

export interface TcbInfo {
  mrtd: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
  rtmr3: string;
  compose_hash?: string;
  /** The deployment manifest the compose hash is taken over: `sha256(app_compose) === compose_hash`. */
  app_compose?: string;
}

/** NEAR AI Cloud wraps the OHTTP receiver key in an ed25519 signature the party publishes alongside the quote. */
export interface OhttpAttestation {
  signing_algo: string;
  signing_key: string;
  key_config: string;
  signature: string;
}

/** The log of what the VM's compose manager actually did, hashed into a second quote's report_data. */
export interface ComposeManagerAttestation {
  actions: { action: string }[];
  actions_hash: string;
  nonce: string;
  nonce_source: string;
  quote: string;
  report_data: string;
}

export interface AttestedParty {
  signing_algo: string;
  signing_address: string;
  request_nonce: string;
  intel_quote: string;
  /** The gateway sends this double-encoded as a JSON string; models send an array. */
  event_log: EventLogEntry[] | string;
  signing_public_key?: string;
  report_data?: string;
  model_name?: string;
  info?: { tcb_info?: TcbInfo; compose_hash?: string; app_name?: string; app_cert?: string };
  ohttp_attestation?: OhttpAttestation;
  compose_manager_attestation?: ComposeManagerAttestation;
  /** NVIDIA's GPU evidence, sent as a JSON string. Its `nonce` must be the nonce we asked for. */
  nvidia_payload?: string;
}

export interface AttestationBundle {
  gateway_attestation?: AttestedParty;
  model_attestations: AttestedParty[];
  /** Some reports carry the OHTTP attestation at the top level instead of per party. */
  ohttp_attestation?: OhttpAttestation;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Verification {
  ok: boolean;
  checks: Check[];
}

const toHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const fromHex = (value: string): Uint8Array => {
  if (typeof value !== "string") throw new RangeError(`expected a hex string, got ${typeof value}`);
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new RangeError(`not a hex string: "${clean.slice(0, 16)}…"`);
  }
  return Uint8Array.from({ length: clean.length / 2 }, (_, i) =>
    parseInt(clean.slice(2 * i, 2 * i + 2), 16),
  );
};

/** An Ethereum address is the last 20 bytes of keccak256 over the bare 64-byte X‖Y. */
export const addressFromPublicKey = (publicKeyHex: string): string => {
  const publicKey = fromHex(publicKeyHex);
  if (publicKey.length !== 64) {
    throw new RangeError(`secp256k1 public key must be 64 bytes (X‖Y), got ${publicKey.length}`);
  }
  return `0x${toHex(keccak_256(publicKey)).slice(-(ADDRESS_BYTES * 2))}`;
};

const sliceHex = (quote: Uint8Array, offset: number, length: number): string =>
  toHex(quote.slice(offset, offset + length));

export const quoteHeader = (quoteHex: string): { version: number; attestationType: number } => {
  const quote = fromHex(quoteHex);
  if (quote.length < 8) throw new RangeError(`TDX quote header is ${quote.length} bytes`);
  return {
    version: quote[0]! + (quote[1]! << 8),
    attestationType: quote[2]! + (quote[3]! << 8),
  };
};

const quoteBody = (quoteHex: string): Uint8Array => {
  const quote = fromHex(quoteHex);
  if (quote.length < QUOTE_MIN_BYTES) {
    throw new RangeError(`TDX quote is ${quote.length} bytes, too short to hold a report body`);
  }
  return quote;
};

/** `report_data` is the only field the hardware signs for us, so it is the only place a binding counts. */
export const quoteReportData = (quoteHex: string): string =>
  sliceHex(quoteBody(quoteHex), REPORT_DATA_OFFSET, ADDRESS_BYTES + 12 + NONCE_BYTES);

export const quoteRegisters = (
  quoteHex: string,
): { mrtd: string; rtmr: string[] } => {
  const quote = quoteBody(quoteHex);
  return {
    mrtd: sliceHex(quote, MRTD_OFFSET, REGISTER_BYTES),
    rtmr: [0, 1, 2, 3].map((i) => sliceHex(quote, RTMR0_OFFSET + i * REGISTER_BYTES, REGISTER_BYTES)),
  };
};

export const parseEventLog = (
  eventLog: EventLogEntry[] | string,
): { entries: EventLogEntry[]; digestless: number } => {
  let entries: unknown = eventLog;
  if (typeof entries === "string") {
    entries = JSON.parse(entries) as unknown;
  }
  if (!Array.isArray(entries)) throw new RangeError("event_log is neither an array nor a JSON array");
  const shaped = entries.filter(
    (entry): entry is EventLogEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as EventLogEntry).imr === "number" &&
      typeof (entry as EventLogEntry).digest === "string",
  );
  const digestless = shaped.filter((entry) => entry.digest === "").length;
  for (const entry of shaped) {
    if (entry.imr < 0 || entry.imr > 3) throw new RangeError(`event log IMR ${entry.imr} is out of range`);
  }
  return { entries: shaped, digestless };
};

/**
 * RTMR[i] extends as sha384(RTMR[i] ‖ digest). Entries with an empty digest are runtime
 * placeholders — every one NEAR AI returns sits on IMR 3 — so they are skipped, never zero-extended.
 */
export const replayRegisters = (entries: EventLogEntry[]): string[] => {
  const registers = [0, 1, 2, 3].map(() => new Uint8Array(REGISTER_BYTES));
  for (const entry of entries) {
    if (entry.digest === "") continue;
    const digest = fromHex(entry.digest);
    if (digest.length !== REGISTER_BYTES) {
      throw new RangeError(`event log digest is ${digest.length} bytes, expected ${REGISTER_BYTES} (SHA-384)`);
    }
    const current = registers[entry.imr]!;
    registers[entry.imr] = sha384(Uint8Array.from([...current, ...digest]));
  }
  return registers.map(toHex);
};

const check = (name: string, ok: boolean, detail: string): Check => ({ name, ok, detail });

const utf8 = (value: string): Uint8Array => Uint8Array.from(new TextEncoder().encode(value));

/** sha256 over the UTF-8 bytes of a string, as the 64-char lowercase hex every one of these bindings is stated in. */
export const sha256Hex = (value: string): string => toHex(sha256(utf8(value)));

/** Live reports satisfy `sha256(app_compose) === compose_hash` for every party, so the manifest is checkable offline. */
export const composeManifestHash = (appCompose: string): string => sha256Hex(appCompose);

export interface ComposeManifest {
  name: string;
  runner: string;
  publicLogs: boolean;
  publicSysinfo: boolean;
  images: string[];
}

export const parseComposeManifest = (appCompose: string): ComposeManifest => {
  const manifest = JSON.parse(appCompose) as Record<string, unknown>;
  if (manifest === null || typeof manifest !== "object") throw new RangeError("compose manifest is not an object");
  const composeFile = typeof manifest.docker_compose_file === "string" ? manifest.docker_compose_file : "";
  return {
    name: String(manifest.name ?? ""),
    runner: String(manifest.runner ?? ""),
    publicLogs: manifest.public_logs === true,
    publicSysinfo: manifest.public_sysinfo === true,
    images: [...composeFile.matchAll(/image:\s*(\S+@sha256:[0-9a-f]{64})/g)].map((match) => match[1]!),
  };
};

/** Hex in, hex in, boolean out — a malformed field fails the check instead of throwing. */
export const verifyEd25519 = (signatureHex: string, messageHex: string, publicKeyHex: string): boolean => {
  try {
    const signature = fromHex(signatureHex);
    const publicKey = fromHex(publicKeyHex);
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    return ed25519.verify(signature, fromHex(messageHex), publicKey);
  } catch {
    return false;
  }
};

const ZERO_REGISTERS = "0".repeat(REGISTER_BYTES * 2);

type AddCheck = (suffix: string, ok: boolean, detail: string) => void;

/**
 * The bindings beyond the quote itself: the manifest the compose hash covers, the OHTTP key wrapper,
 * the GPU evidence nonce, and the compose manager's action log. Each is optional in the report, so a
 * party that omits a field simply produces no checks for it rather than a failure.
 */
const verifyExtraBindings = (
  add: AddCheck,
  party: AttestedParty,
  expectedNonce: string,
  registers: { mrtd: string; rtmr: string[] },
): void => {
  const appCompose = party.info?.tcb_info?.app_compose;
  const statedComposeHash = party.info?.tcb_info?.compose_hash ?? party.info?.compose_hash;
  if (appCompose !== undefined && statedComposeHash !== undefined) {
    try {
      const computed = composeManifestHash(appCompose);
      const expected = toHex(fromHex(statedComposeHash));
      add(
        "compose_hash_matches_manifest",
        computed === expected,
        `sha256(app_compose) ${computed.slice(0, 24)}… vs stated ${expected.slice(0, 24)}…`,
      );
      const manifest = parseComposeManifest(appCompose);
      add(
        "manifest_keeps_logs_private",
        !manifest.publicLogs,
        `public_logs ${manifest.publicLogs}, public_sysinfo ${manifest.publicSysinfo} (${manifest.name}/${manifest.runner}) — sysinfo is what serves this report; public logs would carry request content`,
      );
      add("manifest_pins_image_digests", manifest.images.length > 0, `${manifest.images.length} image(s) pinned by digest`);
    } catch (error) {
      add("manifest_parses", false, String(error));
    }
  }

  const ohttp = party.ohttp_attestation;
  if (ohttp !== undefined) {
    add("ohttp_algo_is_ed25519", ohttp.signing_algo === "ed25519", `signing_algo ${ohttp.signing_algo}`);
    add(
      "ohttp_key_config_signed",
      verifyEd25519(ohttp.signature, ohttp.key_config, ohttp.signing_key),
      `ed25519 over ${ohttp.key_config.length / 2} bytes of key_config by ${ohttp.signing_key.slice(0, 16)}…`,
    );
  }

  if (party.nvidia_payload !== undefined) {
    try {
      const evidence = JSON.parse(party.nvidia_payload) as { nonce?: unknown; evidence_list?: unknown[] };
      add(
        "gpu_evidence_binds_our_nonce",
        evidence.nonce === expectedNonce,
        `payload nonce ${String(evidence.nonce).slice(0, 24)}…`,
      );
      add(
        "gpu_evidence_present",
        Array.isArray(evidence.evidence_list) && evidence.evidence_list.length > 0,
        `${evidence.evidence_list?.length ?? 0} GPU evidence record(s)`,
      );
    } catch (error) {
      add("gpu_payload_parses", false, String(error));
    }
  }

  const manager = party.compose_manager_attestation;
  if (manager !== undefined) {
    add(
      "compose_manager_binds_our_nonce",
      manager.nonce === expectedNonce && manager.nonce_source === "client",
      `${manager.actions.length} action(s), nonce_source ${manager.nonce_source}`,
    );
    let managerQuote: { mrtd: string; rtmr: string[] };
    try {
      managerQuote = quoteRegisters(manager.quote);
    } catch (error) {
      add("compose_manager_quote_parses", false, String(error));
      return;
    }
    const reportData = toHex(fromHex(manager.report_data));
    const quoteReportDataValue = sliceHex(fromHex(manager.quote), REPORT_DATA_OFFSET, NONCE_BYTES * 2);
    add(
      "compose_manager_quote_binds_actions_hash",
      reportData === quoteReportDataValue &&
        reportData.slice(0, NONCE_BYTES * 2) === toHex(fromHex(manager.actions_hash)) &&
        reportData.slice(NONCE_BYTES * 2) === expectedNonce,
      `report_data is actions_hash ‖ our nonce (${reportData.slice(0, 16)}…)`,
    );
    add(
      "compose_manager_measured_the_same_vm",
      managerQuote.mrtd === registers.mrtd &&
        [0, 1, 2].every((index) => managerQuote.rtmr[index] === registers.rtmr[index]),
      "mrtd + rtmr0..2 match the party quote; rtmr3 may differ because runtime actions extend it",
    );
  }
};

const verifyParty = (label: string, party: AttestedParty, expectedNonce: string): Check[] => {
  const checks: Check[] = [];
  const add = (suffix: string, ok: boolean, detail: string): void => {
    checks.push(check(`${label}.${suffix}`, ok, detail));
  };

  add("nonce_is_ours", party.request_nonce === expectedNonce, `request_nonce ${party.request_nonce}`);
  add("algo_is_ecdsa", party.signing_algo === "ecdsa", `signing_algo ${party.signing_algo}`);

  let quote: Uint8Array;
  try {
    quote = quoteBody(party.intel_quote);
  } catch (error) {
    add("quote_parses", false, String(error));
    return checks;
  }
  add("quote_parses", true, `${quote.length} bytes`);

  const header = quoteHeader(party.intel_quote);
  add(
    "quote_is_tdx_v4_ecdsa",
    header.version === QUOTE_VERSION_TDX && header.attestationType === QUOTE_TYPE_ECDSA_P256,
    `version ${header.version}, attestation type ${header.attestationType}`,
  );

  const reportData = sliceHex(quote, REPORT_DATA_OFFSET, ADDRESS_BYTES + 12 + NONCE_BYTES);
  const boundAddress = reportData.slice(0, ADDRESS_BYTES * 2);
  const pad = reportData.slice(ADDRESS_BYTES * 2, (ADDRESS_BYTES + 12) * 2);
  const boundNonce = reportData.slice((ADDRESS_BYTES + 12) * 2);
  add("quote_binds_our_nonce", boundNonce === expectedNonce, `report_data nonce ${boundNonce.slice(0, 16)}…`);
  add(
    "quote_binds_signing_address",
    boundAddress === party.signing_address.replace(/^0x/, "").toLowerCase(),
    `report_data address ${boundAddress}`,
  );
  add("report_data_padding_is_zero", pad === "0".repeat(24), `12 bytes after the address: ${pad}`);

  if (party.report_data !== undefined) {
    const stated = toHex(fromHex(party.report_data));
    add("stated_report_data_matches_quote", stated === reportData, `report_data ${stated.slice(0, 24)}…`);
  }

  if (party.signing_public_key !== undefined) {
    const derived = addressFromPublicKey(party.signing_public_key);
    add(
      "public_key_hashes_to_signing_address",
      derived.toLowerCase() === party.signing_address.toLowerCase(),
      `keccak256(X‖Y)[12:] = ${derived}`,
    );
  }

  let registers: { mrtd: string; rtmr: string[] };
  try {
    registers = quoteRegisters(party.intel_quote);
  } catch (error) {
    add("registers_readable", false, String(error));
    return checks;
  }
  add(
    "registers_are_measured",
    registers.rtmr.slice(0, 3).every((register) => register !== ZERO_REGISTERS),
    `mrtd ${registers.mrtd.slice(0, 16)}…, rtmr0..2 non-zero`,
  );

  let log: { entries: EventLogEntry[]; digestless: number };
  try {
    log = parseEventLog(party.event_log);
  } catch (error) {
    add("event_log_parses", false, String(error));
    return checks;
  }
  add(
    "event_log_parses",
    log.entries.length > 0,
    `${log.entries.length} entries, ${log.digestless} without a digest`,
  );

  let replayed: string[];
  try {
    replayed = replayRegisters(log.entries);
  } catch (error) {
    add("event_log_replays", false, String(error));
    return checks;
  }
  for (const index of [0, 1, 2]) {
    add(
      `rtmr${index}_replays_from_event_log`,
      replayed[index] === registers.rtmr[index],
      `replayed ${replayed[index]?.slice(0, 16)}… vs quote ${registers.rtmr[index]?.slice(0, 16)}…`,
    );
  }
  add(
    "rtmr3_needs_an_allow_list",
    log.digestless > 0,
    `${log.digestless} digestless entries mean RTMR3 is pinned by app/os hashes, not by this log`,
  );

  // Everything below reads fields the gateway merely states, so any of them can be malformed hex.
  try {
    const tcb = party.info?.tcb_info;
    if (tcb !== undefined) {
      const same = toHex(fromHex(tcb.mrtd)) === registers.mrtd;
      const rtmrsMatch = [0, 1, 2, 3].every(
        (i) => toHex(fromHex(tcb[`rtmr${i}` as keyof TcbInfo] as string)) === registers.rtmr[i],
      );
      add("stated_measurements_match_quote", same && rtmrsMatch, "info.tcb_info mrtd + rtmr0..3 vs the quote");
    }

    verifyExtraBindings(add, party, expectedNonce, registers);
  } catch (error) {
    add("stated_fields_malformed", false, String(error));
  }
  return checks;
};

export const verifyAttestationBundle = (
  bundle: AttestationBundle,
  expectedNonce: string,
): Verification => {
  if (!/^[0-9a-f]{64}$/.test(expectedNonce)) {
    throw new RangeError("expectedNonce must be 32 bytes of lowercase hex");
  }
  const checks: Check[] = [];
  if (bundle.gateway_attestation !== undefined) {
    checks.push(...verifyParty("gateway", bundle.gateway_attestation, expectedNonce));
  } else {
    checks.push(check("gateway", false, "bundle has no gateway_attestation"));
  }
  if (bundle.model_attestations.length === 0) {
    checks.push(check("models", false, "bundle has no model_attestations"));
  }
  bundle.model_attestations.forEach((attestation, index) => {
    checks.push(...verifyParty(attestation.model_name ?? `model${index}`, attestation, expectedNonce));
  });
  const ohttp = bundle.ohttp_attestation;
  if (ohttp !== undefined && bundle.gateway_attestation?.ohttp_attestation === undefined) {
    checks.push(
      check(
        "ohttp.key_config_signed",
        verifyEd25519(ohttp.signature, ohttp.key_config, ohttp.signing_key),
        `top-level ${ohttp.signing_algo} signature over ${ohttp.key_config.length / 2} bytes of key_config`,
      ),
    );
  }
  return { ok: checks.every((entry) => entry.ok), checks };
};

// --- the AI redaction bundle (S-8.5) -------------------------------------------------------------
//
// `POST /ai/redact` keeps nothing, so everything that would let somebody check the answer later has to
// travel back in one payload and be stored by the tipster: the report, the exact bytes the response
// signature is taken over, and the signature itself. This is what that stored file is re-checked against,
// offline, by somebody who trusts none of the parties involved.
//
// Verification deliberately does not run in `apps/api`: §5 of `project_structure.md` keeps
// `packages/crypto` out of that process, ARCHITECTURE §14.4 records that a browser cannot do the curve
// checks either, and a proxy grading its own work is not evidence. The proxy assembles; the tipster and
// `scripts/verify-attestation.ts` verify.

/**
 * JSON with keys sorted and no insignificant whitespace.
 *
 * The hash a tipster commits on chain has to be reproducible from a file somebody else wrote, so it
 * cannot depend on the order a provider happened to serialize its fields in. `undefined` is dropped, the
 * same way `JSON.stringify` drops it, so an omitted field and an absent one hash alike.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "string" || kind === "boolean" || kind === "number") {
    if (kind === "number" && !Number.isFinite(value)) throw new RangeError(`cannot canonicalize ${String(value)}`);
    return JSON.stringify(value);
  }
  if (kind !== "object") throw new RangeError(`cannot canonicalize a ${kind} value`);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
};

/** What `GET /v1/signature/<chat_id>` states about one completion (ARCHITECTURE §7.3). */
export interface RedactionSignature {
  chat_id: string;
  signing_algo: string;
  signing_address: string;
  /** `"<model>:<sha256(req)>:<sha256(resp)>"`, as the gateway words it. */
  text: string;
  /** 65 bytes of r‖s‖v, hex. The curve check is listed in `unchecked`, not silently passed. */
  signature: string;
}

/** Everything the redaction proxy hands back and nothing it keeps. */
export interface RedactionBundle {
  version: 1;
  /** The 32 bytes the tipster's own client chose, which the quote is made to bind. */
  nonce: string;
  /** Canonical model id, as it appears in the signature text. */
  model: string;
  /** The exact JSON string sent to `/v1/chat/completions`; its sha256 is the middle field of the signature text. */
  request_text: string;
  /** The exact body that came back; its sha256 is the last field. */
  response_text: string;
  attestation: AttestationBundle;
  signature: RedactionSignature;
}

/** The message NEAR AI Cloud signs for a completion, from the bytes rather than from what it claims to have signed. */
export const responseSignatureText = (model: string, requestText: string, responseText: string): string =>
  `${model}:${sha256Hex(requestText)}:${sha256Hex(responseText)}`;

const ATTESTATION_HASH_DOMAIN = "sealedtip-attestation-v1";

/**
 * The 32 bytes a tipster commits as `attestation_hash`: sha256 over a domain tag and the canonical
 * bundle. Because the response bytes are in there, the commitment binds the model's actual answer, not
 * just the enclave that produced it.
 */
export const attestationHashOf = (bundle: RedactionBundle): string =>
  sha256Hex(`${ATTESTATION_HASH_DOMAIN}\n${canonicalJson(bundle)}`);

/** What a bundle this code can read still cannot prove on its own. Said out loud instead of scored as a pass. */
export const UNCHECKED_ATTESTATION_CLAIMS: string[] = [
  "the secp256k1 signature over the stated text: checked here for what it claims, not that it is valid — that needs a curve implementation, and `@noble/curves` is an ask-first dependency (ROADMAP S-0.3 gap b)",
  "the Intel DCAP certificate chain over each quote, which needs collateral; the in-band dstack chain is checked by `scripts/verify-attestation.ts`, with a root pinned by `--pin-ca`",
  "RTMR3, which is pinned by an app/os allow-list rather than replayed from the event log",
];

export interface RedactionVerification extends Verification {
  readonly unchecked: string[];
}

const shortHex = (value: string): string => `${value.slice(0, 24)}${value.length > 24 ? "…" : ""}`;
const bytesOf = (value: unknown): string =>
  typeof value === "string" ? `${new TextEncoder().encode(value).length} bytes` : typeof value;

/**
 * Re-verify a stored redaction bundle against the nonce the client chose.
 *
 * A detail here may state a hash, an address or a byte count, never the request text: the file being
 * verified contains the tipster's own words, and the checks are what gets pasted into an issue.
 */
export const verifyRedactionBundle = (
  bundle: RedactionBundle,
  expectedNonce: string,
): RedactionVerification => {
  if (!/^[0-9a-f]{64}$/.test(expectedNonce)) {
    throw new RangeError("expectedNonce must be 32 bytes of lowercase hex");
  }
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push(check(`bundle.${name}`, ok, detail));
  };

  const report = bundle?.attestation;
  const readable =
    report !== undefined && report !== null && Array.isArray(report.model_attestations);
  if (!readable) {
    add("attestation_report_present", false, `bundle carries ${bytesOf(report)}`);
    return { ok: false, checks, unchecked: [...UNCHECKED_ATTESTATION_CLAIMS] };
  }
  checks.push(...verifyAttestationBundle(report, expectedNonce).checks);

  add("version", bundle.version === 1, `bundle version ${String(bundle.version)}`);
  add("nonce_is_the_one_we_chose", bundle.nonce === expectedNonce, `bundle states ${bundle.nonce}`);
  add(
    "model_is_stated",
    typeof bundle.model === "string" && bundle.model.length > 0,
    `model ${bytesOf(bundle.model)}`,
  );
  add(
    "request_and_response_bytes_are_stored",
    typeof bundle.request_text === "string" &&
      bundle.request_text.length > 0 &&
      typeof bundle.response_text === "string" &&
      bundle.response_text.length > 0,
    `request ${bytesOf(bundle.request_text)}, response ${bytesOf(bundle.response_text)}`,
  );

  const signature = bundle.signature ?? ({} as RedactionSignature);
  const recomputed = responseSignatureText(bundle.model, bundle.request_text, bundle.response_text);
  add(
    "signature_text_binds_request_and_response",
    signature.text === recomputed,
    `stated ${shortHex(String(signature.text))} vs recomputed ${shortHex(recomputed)}`,
  );
  const address = String(signature.signing_address ?? "").toLowerCase();
  const signers = report.model_attestations.filter(
    (party) => party.signing_address?.toLowerCase() === address,
  );
  add(
    "signature_address_is_attested",
    address.length > 0 && signers.length === 1,
    `${signers.length} of ${report.model_attestations.length} model parties state signing_address ${address}`,
  );
  add(
    "attested_model_is_the_bundle_model",
    signers.length === 1 && signers[0]?.model_name === bundle.model,
    `bundle says ${bundle.model}, the quote says ${String(signers[0]?.model_name)}`,
  );
  add(
    "signature_is_65_bytes",
    /^(0x)?[0-9a-f]{130}$/.test(String(signature.signature ?? "")),
    `signature is ${String(signature.signature ?? "").replace(/^0x/, "").length / 2} bytes`,
  );
  add(
    "chat_id_is_stated",
    typeof signature.chat_id === "string" && signature.chat_id.length > 0,
    `chat_id ${bytesOf(signature.chat_id)}`,
  );

  return { ok: checks.every((entry) => entry.ok), checks, unchecked: [...UNCHECKED_ATTESTATION_CLAIMS] };
};
