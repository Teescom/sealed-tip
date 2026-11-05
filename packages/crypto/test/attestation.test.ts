import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addressFromPublicKey,
  fromHex,
  parseEventLog,
  quoteHeader,
  quoteRegisters,
  quoteReportData,
  replayRegisters,
  verifyAttestationBundle,
  type AttestationBundle,
  type AttestedParty,
  type EventLogEntry,
} from "../src/attestation.js";

const NONCE = "11".repeat(32);
const REGISTER_BYTES = 48;
const QUOTE_BYTES = 5006;

const repeat = (byte: number, length: number): Uint8Array => Uint8Array.from({ length }, () => byte);
const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** A public key is 64 bytes of X‖Y; the address is the last 20 bytes of its keccak. */
const fakeKey = (seed: number): string =>
  hex(Uint8Array.from({ length: 64 }, (_, i) => (seed * 31 + i * 7) % 256));

/** Reality: digests on IMR 0-2 plus digestless IMR 3 placeholders that no caller can replay. */
const eventLog = (seed: number): EventLogEntry[] => [
  ...[0, 1, 2, 0, 1, 2].map((imr, i) => ({ imr, digest: hex(repeat(seed + i, REGISTER_BYTES)) })),
  ...[0, 1].map(() => ({ imr: 3, digest: "" })),
];

const buildQuote = (address: string, nonce: string, mrtd: string, rtmr: string[]): Uint8Array => {
  const quote = repeat(0, QUOTE_BYTES);
  quote[0] = 4;
  quote[2] = 2;
  quote.set(fromHex(mrtd), 184);
  rtmr.forEach((register, i) => quote.set(fromHex(register), 376 + i * REGISTER_BYTES));
  quote.set(fromHex(address), 568);
  quote.set(fromHex(nonce), 568 + 20 + 12);
  return quote;
};

const buildParty = (overrides: Partial<AttestedParty> = {}): AttestedParty => {
  const publicKey = overrides.signing_public_key ?? fakeKey(3);
  const address = addressFromPublicKey(publicKey).slice(2);
  const log = overrides.event_log ?? eventLog(10);
  const entries = Array.isArray(log) ? log : parseEventLog(log).entries;
  const replayed = replayRegisters(entries);
  const mrtd = hex(repeat(99, REGISTER_BYTES));
  const party: AttestedParty = {
    signing_algo: "ecdsa",
    signing_address: `0x${address}`,
    signing_public_key: publicKey,
    request_nonce: NONCE,
    intel_quote: hex(buildQuote(address, NONCE, mrtd, replayed)),
    event_log: log,
    info: {
      tcb_info: {
        mrtd,
        rtmr0: replayed[0]!,
        rtmr1: replayed[1]!,
        rtmr2: replayed[2]!,
        rtmr3: replayed[3]!,
      },
    },
  };
  return { ...party, ...overrides };
};

const buildBundle = (model: Partial<AttestedParty> = {}, gateway: Partial<AttestedParty> = {}): AttestationBundle => {
  const gatewayParty = buildParty(gateway);
  delete gatewayParty.signing_public_key;
  gatewayParty.report_data = quoteReportData(gatewayParty.intel_quote);
  // The live API double-encodes the gateway log; the model log arrives as an array.
  gatewayParty.event_log = JSON.stringify(gatewayParty.event_log);
  return { gateway_attestation: gatewayParty, model_attestations: [buildParty(model)] };
};

const failing = (bundle: AttestationBundle, needle: string, nonce = NONCE): string[] =>
  verifyAttestationBundle(bundle, nonce)
    .checks.filter((c) => !c.ok && c.name.includes(needle))
    .map((c) => c.name);

const names = (bundle: AttestationBundle): string[] =>
  verifyAttestationBundle(bundle, NONCE).checks.map((c) => c.name);

test("a well-formed bundle verifies every binding we claim", () => {
  const result = verifyAttestationBundle(buildBundle(), NONCE);
  assert.equal(
    result.ok,
    true,
    result.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join(" | "),
  );
  for (const name of [
    "gateway.quote_binds_our_nonce",
    "gateway.quote_binds_signing_address",
    "gateway.stated_report_data_matches_quote",
    "gateway.event_log_parses",
    "gateway.rtmr0_replays_from_event_log",
    "gateway.rtmr2_replays_from_event_log",
    "gateway.rtmr3_needs_an_allow_list",
    "gateway.stated_measurements_match_quote",
    "gateway.quote_is_tdx_v4_ecdsa",
    "model0.public_key_hashes_to_signing_address",
  ]) {
    assert.ok(result.checks.some((c) => c.name === name && c.ok), `missing ${name}`);
  }
});

test("the gateway attestation carries no public key, so nothing pretends it does", () => {
  const bundle = buildBundle();
  assert.equal(bundle.gateway_attestation?.signing_public_key, undefined);
  assert.equal(names(bundle).some((name) => name.endsWith("public_key_hashes_to_signing_address") && name.startsWith("gateway.")), false);
});

test("the address is keccak256 of X‖Y, not of a SEC1-prefixed key", () => {
  const key = fakeKey(11);
  assert.equal(fromHex(key).length, 64);
  assert.match(addressFromPublicKey(key), /^0x[0-9a-f]{40}$/);
  assert.notEqual(addressFromPublicKey(key), addressFromPublicKey(fakeKey(12)));
  assert.throws(() => addressFromPublicKey(`04${"ab".repeat(64)}`), RangeError);
});

test("a bundle built for another nonce fails the quote binding", () => {
  const bundle = buildBundle();
  const other = "22".repeat(32);
  assert.equal(verifyAttestationBundle(bundle, other).ok, false);
  assert.ok(failing(bundle, "quote_binds_our_nonce", other).length > 0);
});

test("a redirected signing address fails", () => {
  const bundle = buildBundle();
  bundle.model_attestations[0]!.signing_address = `0x${"cd".repeat(20)}`;
  assert.equal(verifyAttestationBundle(bundle, NONCE).ok, false);
  assert.ok(failing(bundle, "quote_binds_signing_address").length > 0);
  assert.ok(failing(bundle, "public_key_hashes_to_signing_address").length > 0);
});

test("a tampered event log stops replaying into the attested registers", () => {
  const bundle = buildBundle();
  const party = bundle.model_attestations[0]!;
  party.event_log = (party.event_log as EventLogEntry[]).map((entry, i) =>
    i === 0 ? { ...entry, digest: hex(repeat(123, REGISTER_BYTES)) } : entry,
  );
  assert.equal(verifyAttestationBundle(bundle, NONCE).ok, false);
  assert.ok(failing(bundle, "rtmr0_replays_from_event_log").length > 0);
});

test("a digestless IMR 3 entry is skipped, never zero-extended into the register", () => {
  const digests = eventLog(10).filter((entry) => entry.digest !== "");
  assert.deepEqual(replayRegisters(digests), replayRegisters(eventLog(10)));
  assert.notDeepEqual(
    replayRegisters(digests),
    replayRegisters([...digests, { imr: 3, digest: "00".repeat(REGISTER_BYTES) }]),
  );
});

test("nothing checks RTMR3 by replay, because the log cannot reach it", () => {
  assert.equal(
    names(buildBundle()).filter((name) => name.endsWith("rtmr3_replays_from_event_log")).length,
    0,
  );
  assert.ok(names(buildBundle()).includes("gateway.rtmr3_needs_an_allow_list"));
});

test("a quote too short to hold a report body is refused, not half-read", () => {
  const bundle = buildBundle();
  bundle.model_attestations[0]!.intel_quote = "0400" + "00".repeat(100);
  assert.equal(verifyAttestationBundle(bundle, NONCE).ok, false);
  assert.ok(failing(bundle, "quote_parses").length > 0);
});

test("a non-TDX-v4 quote fails the version check", () => {
  const bundle = buildBundle();
  const party = bundle.model_attestations[0]!;
  const quote = Uint8Array.from(fromHex(party.intel_quote));
  quote[0] = 3;
  party.intel_quote = hex(quote);
  assert.equal(quoteHeader(party.intel_quote).version, 3);
  assert.equal(verifyAttestationBundle(bundle, NONCE).ok, false);
  assert.ok(failing(bundle, "quote_is_tdx_v4_ecdsa").length > 0);
});

test("zeroed registers in a quote are not a measurement", () => {
  const bundle = buildBundle();
  const party = bundle.model_attestations[0]!;
  const quote = Uint8Array.from(fromHex(party.intel_quote));
  quote.fill(0, 376, 376 + REGISTER_BYTES);
  party.intel_quote = hex(quote);
  assert.equal(quoteRegisters(party.intel_quote).rtmr[0], "0".repeat(REGISTER_BYTES * 2));
  assert.equal(verifyAttestationBundle(bundle, NONCE).ok, false);
  assert.ok(failing(bundle, "registers_are_measured").length > 0);
});

test("the padding between address and nonce must stay zero", () => {
  const bundle = buildBundle();
  const party = bundle.model_attestations[0]!;
  const quote = Uint8Array.from(fromHex(party.intel_quote));
  quote[568 + 20] = 7;
  party.intel_quote = hex(quote);
  party.report_data = quoteReportData(party.intel_quote);
  assert.equal(verifyAttestationBundle(bundle, NONCE).ok, false);
  assert.ok(failing(bundle, "report_data_padding_is_zero").length > 0);
});

test("a hostile event log fails a check instead of crashing the verifier", () => {
  const hostiles: unknown[] = ["not json", '{"imr":0}', "[]", [{ imr: 9, digest: "ab" }]];
  for (const hostile of hostiles) {
    const bundle = buildBundle();
    bundle.model_attestations[0]!.event_log = hostile as EventLogEntry[];
    const result = verifyAttestationBundle(bundle, NONCE);
    assert.equal(result.ok, false, JSON.stringify(hostile));
    assert.equal(
      result.checks.filter((c) => !c.ok && c.name === "model0.event_log_parses").length,
      1,
      `${JSON.stringify(hostile)} -> ${result.checks.filter((c) => !c.ok).map((c) => c.name).join(",")}`,
    );
  }
});

test("a digest that is not SHA-384 is reported, not hashed anyway", () => {
  const bundle = buildBundle();
  bundle.model_attestations[0]!.event_log = [{ imr: 0, digest: "abcd" }];
  const result = verifyAttestationBundle(bundle, NONCE);
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => c.name === "model0.event_log_replays" && !c.ok));
});

test("a bundle with no model attestations is not a pass", () => {
  const bundle = buildBundle();
  bundle.model_attestations = [];
  const result = verifyAttestationBundle(bundle, NONCE);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.checks.filter((c) => c.name === "models").map((c) => c.detail),
    ["bundle has no model_attestations"],
  );
});

test("a nonce that is not 32 lowercase hex bytes is the caller's bug", () => {
  for (const bad of ["", "1".repeat(63), "ZZ".repeat(32), "ab".repeat(32).toUpperCase()]) {
    assert.throws(() => verifyAttestationBundle(buildBundle(), bad), RangeError);
  }
});
