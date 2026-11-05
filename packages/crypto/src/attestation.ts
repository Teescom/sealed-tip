// NEAR AI Cloud attestation bundle: re-verify offline the bindings that tie a report to the request we made (S-0.3).
// Offsets and field shapes below were measured against live `GET /v1/attestation/report` responses, not recalled from a spec.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha384 } from "@noble/hashes/sha2.js";

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
  info?: { tcb_info?: TcbInfo };
}

export interface AttestationBundle {
  gateway_attestation?: AttestedParty;
  model_attestations: AttestedParty[];
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

const ZERO_REGISTERS = "0".repeat(REGISTER_BYTES * 2);

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

  const tcb = party.info?.tcb_info;
  if (tcb !== undefined) {
    const same = toHex(fromHex(tcb.mrtd)) === registers.mrtd;
    const rtmrsMatch = [0, 1, 2, 3].every(
      (i) => toHex(fromHex(tcb[`rtmr${i}` as keyof TcbInfo] as string)) === registers.rtmr[i],
    );
    add("stated_measurements_match_quote", same && rtmrsMatch, "info.tcb_info mrtd + rtmr0..3 vs the quote");
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
  return { ok: checks.every((entry) => entry.ok), checks };
};
