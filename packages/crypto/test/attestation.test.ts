import { test } from "node:test";
import assert from "node:assert/strict";

import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  addressFromPublicKey,
  composeManifestHash,
  fromHex,
  parseComposeManifest,
  parseEventLog,
  quoteHeader,
  quoteRegisters,
  quoteReportData,
  replayRegisters,
  verifyAttestationBundle,
  verifyEd25519,
  type AttestationBundle,
  type AttestedParty,
  type ComposeManagerAttestation,
  type EventLogEntry,
} from "../src/attestation.js";

ed25519.hashes.sha512 = sha512;

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

// --- the in-band bindings beyond the quote ---------------------------------------------------

const PINNED_IMAGE = `ghcr.io/sealed-tip/worker@sha256:${"0f".repeat(32)}`;

/** A fictional dstack manifest: the shape the report actually ships, with our own image strings. */
const composeManifest = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    manifest_version: 2,
    name: "sealed-tip-spike",
    runner: "docker-compose",
    docker_compose_file: `services:\n  worker:\n    image: ${PINNED_IMAGE}\n`,
    kms_enabled: false,
    gateway_enabled: true,
    public_logs: false,
    public_sysinfo: true,
    ...overrides,
  });

/** Attach a manifest and the hash the party states for it, the way the live report does. */
const withManifest = (bundle: AttestationBundle, appCompose = composeManifest(), stated?: string): AttestationBundle => {
  const tcb = bundle.model_attestations[0]!.info!.tcb_info!;
  tcb.app_compose = appCompose;
  tcb.compose_hash = stated ?? composeManifestHash(appCompose);
  return bundle;
};

/** A real ed25519 pair, so a passing OHTTP check means a signature was actually verified. */
const ohttpKey = (seed: number) => ed25519.keygen(Uint8Array.from({ length: 32 }, (_, i) => seed + i));
const KEY_CONFIG = "19004300a1" + "5e".repeat(45 - 5);

const withOhttp = (bundle: AttestationBundle, seed = 5): AttestationBundle => {
  const { publicKey, secretKey } = ohttpKey(seed);
  bundle.model_attestations[0]!.ohttp_attestation = {
    signing_algo: "ed25519",
    signing_key: hex(publicKey),
    key_config: KEY_CONFIG,
    signature: hex(ed25519.sign(fromHex(KEY_CONFIG), secretKey)),
  };
  return bundle;
};

const withManager = (bundle: AttestationBundle, overrides: Partial<ComposeManagerAttestation> = {}): AttestationBundle => {
  const party = bundle.model_attestations[0]!;
  const registers = quoteRegisters(party.intel_quote);
  const actionsHash = "ab".repeat(32);
  // The manager's quote measures the same VM but RTMR3 has moved on with each action.
  const quote = buildQuote(actionsHash, NONCE, registers.mrtd, [...registers.rtmr.slice(0, 3), "cd".repeat(REGISTER_BYTES)]);
  party.compose_manager_attestation = {
    actions: [{ action: "pull" }, { action: "start" }],
    actions_hash: actionsHash,
    nonce: NONCE,
    nonce_source: "client",
    quote: hex(quote),
    report_data: quoteReportData(hex(quote)),
    ...overrides,
  };
  return bundle;
};

test("the compose hash is sha256 over the manifest, and a swapped manifest is caught", () => {
  assert.equal(composeManifestHash(composeManifest()), composeManifestHash(composeManifest()));
  assert.notEqual(composeManifestHash(composeManifest()), composeManifestHash(composeManifest({ public_logs: true })));

  const ok = withManifest(buildBundle());
  assert.equal(verifyAttestationBundle(ok, NONCE).ok, true, JSON.stringify(ok.model_attestations[0]!.info));

  // The party states a hash for a different manifest than the one it shipped.
  const swapped = withManifest(buildBundle(), composeManifest({ name: "some-other-app" }));
  const tamperedManifest = composeManifest({ name: "sealed-tip-spike" });
  swapped.model_attestations[0]!.info!.tcb_info!.app_compose = tamperedManifest;
  assert.equal(verifyAttestationBundle(swapped, NONCE).ok, false);
  assert.ok(failing(swapped, "compose_hash_matches_manifest").length > 0);
});

test("a manifest that publishes logs, or ships images by tag, fails its check", () => {
  const leaky = withManifest(buildBundle(), composeManifest({ public_logs: true }));
  assert.equal(verifyAttestationBundle(leaky, NONCE).ok, false);
  assert.ok(failing(leaky, "manifest_keeps_logs_private").length > 0);

  const tagOnly = withManifest(
    buildBundle(),
    composeManifest({ docker_compose_file: "services:\n  worker:\n    image: ghcr.io/sealed-tip/worker:latest\n" }),
  );
  assert.equal(verifyAttestationBundle(tagOnly, NONCE).ok, false);
  assert.ok(failing(tagOnly, "manifest_pins_image_digests").length > 0);
  assert.deepEqual(parseComposeManifest(composeManifest()).images, [PINNED_IMAGE]);
});

test("the OHTTP key config is signed by the key it publishes, and nowhere else", () => {
  const bundle = withOhttp(buildBundle());
  assert.equal(verifyAttestationBundle(bundle, NONCE).ok, true);
  assert.ok(
    bundle.model_attestations[0]!.ohttp_attestation !== undefined,
    "the live report carries this per party",
  );

  const wrongKey = withOhttp(buildBundle(), 6);
  wrongKey.model_attestations[0]!.ohttp_attestation!.signing_key = hex(ohttpKey(5).publicKey);
  assert.equal(verifyAttestationBundle(wrongKey, NONCE).ok, false);
  assert.ok(failing(wrongKey, "ohttp_key_config_signed").length > 0);

  const flipped = withOhttp(buildBundle());
  const signature = flipped.model_attestations[0]!.ohttp_attestation!;
  signature.signature = hex(Uint8Array.from(fromHex(signature.signature), (b, i) => (i === 0 ? b ^ 1 : b)));
  assert.equal(verifyAttestationBundle(flipped, NONCE).ok, false);

  const notEd25519 = withOhttp(buildBundle());
  notEd25519.model_attestations[0]!.ohttp_attestation!.signing_algo = "ecdsa";
  assert.ok(failing(notEd25519, "ohttp_algo_is_ed25519").length > 0);
});

test("the top-level OHTTP attestation is checked once, not repeated per party", () => {
  const bundle = withOhttp(buildBundle());
  const ohttp = bundle.model_attestations[0]!.ohttp_attestation!;
  bundle.ohttp_attestation = ohttp;
  delete bundle.model_attestations[0]!.ohttp_attestation;
  const result = verifyAttestationBundle(bundle, NONCE);
  assert.equal(result.ok, true, result.checks.filter((c) => !c.ok).map((c) => c.name).join(","));
  assert.deepEqual(
    result.checks.filter((c) => c.name.endsWith("key_config_signed")).map((c) => c.name),
    ["ohttp.key_config_signed"],
  );
});

test("verifyEd25519 is a boolean, never an exception", () => {
  const { publicKey, secretKey } = ohttpKey(9);
  const signature = hex(ed25519.sign(fromHex(KEY_CONFIG), secretKey));
  assert.equal(verifyEd25519(signature, KEY_CONFIG, hex(publicKey)), true);
  assert.equal(verifyEd25519(signature, KEY_CONFIG.slice(0, -2) + "11", hex(publicKey)), false);
  for (const bad of ["", "zz", "ab".repeat(63), "0xzz", "ab".repeat(64)]) {
    assert.equal(verifyEd25519(bad, KEY_CONFIG, hex(publicKey)), false, bad);
  }
  assert.equal(verifyEd25519(signature, KEY_CONFIG, "ab".repeat(33)), false);
});

test("the GPU evidence nonce is the one we sent", () => {
  const bundle = buildBundle();
  bundle.model_attestations[0]!.nvidia_payload = JSON.stringify({ nonce: NONCE, evidence_list: [{ spa_data: {} }], arch: "hopper" });
  assert.equal(verifyAttestationBundle(bundle, NONCE).ok, true);

  const stale = buildBundle();
  stale.model_attestations[0]!.nvidia_payload = JSON.stringify({ nonce: "22".repeat(32), evidence_list: [{}] });
  assert.ok(failing(stale, "gpu_evidence_binds_our_nonce").length > 0);

  const empty = buildBundle();
  empty.model_attestations[0]!.nvidia_payload = JSON.stringify({ nonce: NONCE, evidence_list: [] });
  assert.ok(failing(empty, "gpu_evidence_present").length > 0);
});

test("the compose manager quotes the same VM and binds its action hash to our nonce", () => {
  const bundle = withManager(buildBundle());
  const result = verifyAttestationBundle(bundle, NONCE);
  assert.equal(result.ok, true, result.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join(" | "));
  const manager = bundle.model_attestations[0]!.compose_manager_attestation!;
  assert.equal(quoteReportData(manager.quote).slice(64), NONCE);
  assert.equal(quoteRegisters(manager.quote).rtmr[3], "cd".repeat(REGISTER_BYTES));

  const notOurs = withManager(buildBundle(), { nonce: "22".repeat(32) });
  assert.ok(failing(notOurs, "compose_manager_binds_our_nonce").length > 0);

  const hashSwapped = withManager(buildBundle(), { actions_hash: "ee".repeat(32) });
  assert.ok(failing(hashSwapped, "compose_manager_quote_binds_actions_hash").length > 0);

  const otherVm = withManager(buildBundle());
  const registers = quoteRegisters(otherVm.model_attestations[0]!.compose_manager_attestation!.quote);
  otherVm.model_attestations[0]!.compose_manager_attestation!.quote = hex(
    buildQuote("ab".repeat(32), NONCE, registers.mrtd, ["01".repeat(REGISTER_BYTES), registers.rtmr[1]!, registers.rtmr[2]!, registers.rtmr[3]!]),
  );
  assert.ok(failing(otherVm, "compose_manager_measured_the_same_vm").length > 0);
});

test("hostile extras fail a check instead of crashing the verifier", () => {
  const cases: ((bundle: AttestationBundle) => void)[] = [
    (bundle) => withManifest(bundle, composeManifest(), "zz".repeat(32)),
    (bundle) => withManifest(bundle, "not json"),
    (bundle) => withManifest(bundle, JSON.stringify([])),
    (bundle) => {
      bundle.model_attestations[0]!.nvidia_payload = "{ broken";
    },
    (bundle) => {
      const party = bundle.model_attestations[0]!;
      party.ohttp_attestation = { signing_algo: "ed25519", signing_key: "zz", key_config: "zz", signature: "zz" };
      party.compose_manager_attestation = {
        actions: [],
        actions_hash: "zz",
        nonce: NONCE,
        nonce_source: "client",
        quote: "0400",
        report_data: "zz",
      };
    },
  ];
  for (const hostile of cases) {
    const bundle = buildBundle();
    hostile(bundle);
    const result = verifyAttestationBundle(bundle, NONCE);
    assert.equal(result.ok, false);
    assert.ok(
      result.checks.some((c) => !c.ok),
      "a malformed field has to show up as a failed check",
    );
  }
});

