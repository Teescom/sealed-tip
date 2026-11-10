// S-8.5: the bundle a tipster keeps is the thing that lets somebody else check the AI answer later, so
// these tests are about bindings that survive the file being rewritten by hand. Two properties matter more
// than the rest: `attestation_hash` has to be reproducible from a re-serialized file (it is what goes on
// chain, and a hash that depends on the order a provider happened to write its keys in is not), and every
// check has to fail as a check rather than as a crash or a silent pass — the secp256k1 one included, which
// is why the fixtures below sign with real keys instead of a hex pattern nobody could have produced.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { concatBytes } from "@noble/curves/utils.js";

import {
  UNCHECKED_ATTESTATION_CLAIMS,
  addressFromPublicKey,
  attestationHashOf,
  canonicalJson,
  eip191Digest,
  fromHex,
  quoteReportData,
  recoverSignerAddress,
  replayRegisters,
  responseSignatureText,
  sha256Hex,
  verifyRedactionBundle,
  type AttestationBundle,
  type AttestedParty,
  type EventLogEntry,
  type RedactionBundle,
} from "../src/attestation.js";

const NONCE = "33".repeat(32);
const MODEL = "fictional-lab/Fictional-Model-0001";
const REGISTER_BYTES = 48;
const QUOTE_BYTES = 5006;
/** The seed `buildBundle` gives the model party, which is the key a passing signature has to come from. */
const MODEL_SEED = 3;

const repeat = (byte: number, length: number): Uint8Array => Uint8Array.from({ length }, () => byte);
const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** A fictional but real secp256k1 key: 64 bytes of X‖Y that a signature can actually recover to. */
const fixtureKey = (seed: number): { secret: Uint8Array; publicKey: string } => {
  const secret = createHash("sha256").update(`sealedtip-fixture-signing-key-${seed}`).digest();
  return { secret, publicKey: hex(secp256k1.getPublicKey(secret, false).subarray(1)) };
};

/** What `GET /v1/signature/<chat_id>` states: r‖s‖v over the EIP-191 digest, with Ethereum's `v` of 27+. */
const personalSign = (secret: Uint8Array, text: string): string => {
  const recoverable = secp256k1.sign(eip191Digest(text), secret, {
    prehash: false,
    format: "recovered",
  });
  return `0x${hex(concatBytes(recoverable.subarray(1), Uint8Array.of(recoverable[0]! + 27)))}`;
};

const eventLog = (seed: number): EventLogEntry[] => [
  ...[0, 1, 2, 0, 1, 2].map((imr, i) => ({ imr, digest: hex(repeat(seed + i, REGISTER_BYTES)) })),
  ...[0, 1].map(() => ({ imr: 3, digest: "" })),
];

const buildQuote = (address: string, nonce: string, mrtd: string, registers: string[]): Uint8Array => {
  const quote = repeat(0, QUOTE_BYTES);
  quote[0] = 4;
  quote[2] = 2;
  quote.set(fromHex(mrtd), 184);
  registers.forEach((register, i) => quote.set(fromHex(register), 376 + i * REGISTER_BYTES));
  quote.set(fromHex(address), 568);
  quote.set(fromHex(nonce), 568 + 20 + 12);
  return quote;
};

/** A party whose quote, registers and stated measurements all agree, so a passing bundle has to fail for a real reason. */
const buildParty = (seed: number, nonce = NONCE): AttestedParty => {
  const { publicKey } = fixtureKey(seed);
  const address = addressFromPublicKey(publicKey).slice(2);
  const log = eventLog(seed * 5);
  const registers = replayRegisters(log);
  const mrtd = hex(repeat(seed, REGISTER_BYTES));
  return {
    signing_algo: "ecdsa",
    signing_address: `0x${address}`,
    signing_public_key: publicKey,
    request_nonce: nonce,
    intel_quote: hex(buildQuote(address, nonce, mrtd, registers)),
    event_log: log,
    info: {
      tcb_info: {
        mrtd,
        rtmr0: registers[0]!,
        rtmr1: registers[1]!,
        rtmr2: registers[2]!,
        rtmr3: registers[3]!,
      },
    },
    model_name: MODEL,
  };
};

/** The gateway sends no public key and double-encodes its log, exactly as the live one does. */
const buildBundle = (nonce = NONCE): AttestationBundle => {
  const gateway = buildParty(7, nonce);
  delete gateway.signing_public_key;
  delete gateway.model_name;
  gateway.report_data = quoteReportData(gateway.intel_quote);
  gateway.event_log = JSON.stringify(gateway.event_log);
  return { gateway_attestation: gateway, model_attestations: [buildParty(MODEL_SEED, nonce)] };
};

const REQUEST = JSON.stringify({
  model: MODEL,
  messages: [
    { role: "system", content: "Reply with JSON only." },
    { role: "user", content: "as the only procurement officer in the Lokoja annex" },
  ],
});
const RESPONSE = JSON.stringify({
  id: "chat-fictional-1",
  choices: [{ message: { content: '{"suggestions":[],"residual_risks":[]}' } }],
});

const buildRedaction = (overrides: Partial<RedactionBundle> = {}): RedactionBundle => {
  const attestation = buildBundle();
  const text = responseSignatureText(MODEL, REQUEST, RESPONSE);
  return {
    version: 1,
    nonce: NONCE,
    model: MODEL,
    request_text: REQUEST,
    response_text: RESPONSE,
    attestation,
    signature: {
      chat_id: "chat-fictional-1",
      signing_algo: "ecdsa",
      signing_address: attestation.model_attestations[0]!.signing_address,
      text,
      signature: personalSign(fixtureKey(MODEL_SEED).secret, text),
    },
    ...overrides,
  };
};

const failing = (bundle: RedactionBundle, needle: string): string[] =>
  verifyRedactionBundle(bundle, NONCE)
    .checks.filter((entry) => !entry.ok && entry.name.includes(needle))
    .map((entry) => entry.name);

const summary = (bundle: RedactionBundle): string =>
  verifyRedactionBundle(bundle, NONCE)
    .checks.filter((entry) => !entry.ok)
    .map((entry) => `${entry.name}: ${entry.detail}`)
    .join(" | ");

/** Reverse every key order in the file, nested, the way a hand-edited or re-serialized one comes back. */
const shuffleKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(shuffleKeys);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).reverse();
  return Object.fromEntries(entries.map(([key, entry]) => [key, shuffleKeys(entry)]));
};

test("a redaction bundle built from a report that binds everything verifies", () => {
  const bundle = buildRedaction();
  assert.equal(bundle.attestation.gateway_attestation?.signing_public_key, undefined);
  const result = verifyRedactionBundle(bundle, NONCE);
  assert.equal(result.ok, true, summary(bundle));
  for (const name of [
    "bundle.signature_text_binds_request_and_response",
    "bundle.signature_address_is_attested",
    "bundle.attested_model_is_the_bundle_model",
    "bundle.signature_is_65_bytes",
    // a party is labelled by the model name it states, which is why the bundle has to say the same one
    `${MODEL}.quote_binds_our_nonce`,
  ]) {
    assert.ok(result.checks.some((entry) => entry.name === name && entry.ok), `missing ${name}`);
  }
});

test("the secp256k1 signature is scored, and the gap list no longer claims it is missing", () => {
  const bundle = buildRedaction();
  const result = verifyRedactionBundle(bundle, NONCE);
  assert.equal(result.ok, true, summary(bundle));
  const curve = result.checks.find(
    (entry) => entry.name === "bundle.signature_recovers_from_the_signing_address_key",
  );
  assert.ok(curve?.ok, `the curve check did not pass: ${JSON.stringify(curve)}`);
  assert.equal(
    curve!.detail.includes(REQUEST),
    false,
    "the detail of a curve check quoted the tipster's request",
  );
  assert.deepEqual(result.unchecked, UNCHECKED_ATTESTATION_CLAIMS);
  assert.equal(
    /secp256k1|@noble\/curves/.test(result.unchecked.join(" ")),
    false,
    "a gap the code now closes is still listed as unproven",
  );
});

test("a signature nobody could have made fails the curve check and nothing else", () => {
  for (const [what, signature] of [
    ["a hex pattern", `0x${"ab".repeat(65)}`],
    ["a signature over other bytes", personalSign(fixtureKey(MODEL_SEED).secret, `${MODEL}:0:0`)],
    ["a signature from a key no quote attests", personalSign(fixtureKey(9).secret, responseSignatureText(MODEL, REQUEST, RESPONSE))],
  ] as [string, string][]) {
    const bundle = buildRedaction();
    bundle.signature.signature = signature;
    const failed = verifyRedactionBundle(bundle, NONCE).checks.filter((entry) => !entry.ok);
    assert.deepEqual(
      failed.map((entry) => entry.name),
      ["bundle.signature_recovers_from_the_signing_address_key"],
      `${what} was not caught, or caught too much: ${JSON.stringify(failed)}`,
    );
  }
});

test("recovering an address needs a curve, not just the right number of bytes", () => {
  const text = `${MODEL}: fictional-lab/Ünicode-Модель:0:0`;
  const { secret, publicKey } = fixtureKey(MODEL_SEED);
  const address = addressFromPublicKey(publicKey).toLowerCase();
  assert.equal(recoverSignerAddress(personalSign(secret, text), text)?.toLowerCase(), address);
  // one character more is a different digest, and a different digest recovers a different signer
  assert.notEqual(recoverSignerAddress(personalSign(secret, text), `${text}x`), address);
  const evm = fromHex(personalSign(secret, text));
  // the same key signs with `v` of 0/1 too, and a `v` outside 0..3 or 27..30 recovers nothing
  const low = `0x${hex(concatBytes(evm.subarray(0, 64), Uint8Array.of(evm[64]! - 27)))}`;
  assert.equal(recoverSignerAddress(low, text)?.toLowerCase(), address);
  for (const unusable of ["", "0xzz", `0x${"ab".repeat(64)}`, `0x${"ab".repeat(66)}`, `0x${"ab".repeat(64)}ff`]) {
    assert.equal(recoverSignerAddress(unusable, text), undefined, unusable);
  }
});

test("the hash is sha256 over the canonical bundle and is 32 bytes of hex", () => {
  const bundle = buildRedaction();
  const hash = attestationHashOf(bundle);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(
    hash,
    sha256Hex(`sealedtip-attestation-v1\n${canonicalJson(bundle)}`),
    "the hash is not over the bytes this function says it is",
  );
});

test("the hash survives a round trip through a file, in whatever order it gets rewritten", () => {
  const bundle = buildRedaction();
  const expected = attestationHashOf(bundle);
  const shuffled = JSON.parse(JSON.stringify(shuffleKeys(bundle))) as RedactionBundle;
  assert.notEqual(
    JSON.stringify(shuffled).slice(0, 40),
    JSON.stringify(bundle).slice(0, 40),
    "the fixture shuffled nothing",
  );
  assert.equal(attestationHashOf(shuffled), expected);
  assert.equal(attestationHashOf({ ...bundle, extra: undefined } as RedactionBundle), expected);
  assert.notEqual(
    attestationHashOf({ ...bundle, extra: "typed by hand" } as unknown as RedactionBundle),
    expected,
    "a field nobody wrote was hashed as if it were not there",
  );
});

test("the hash binds the model's answer, not just the enclave that produced it", () => {
  const before = buildRedaction();
  const after = buildRedaction({ response_text: RESPONSE.replace("suggestions", "SUGGESTIONS") });
  assert.notEqual(attestationHashOf(before), attestationHashOf(after));
  assert.deepEqual(failing(after, "signature_text_binds"), [
    "bundle.signature_text_binds_request_and_response",
  ]);
});

test("a signature text that was not recomputed from these bytes fails on its own", () => {
  const bundle = buildRedaction({
    signature: { ...buildRedaction().signature, text: `${MODEL}:0:0` },
  });
  assert.deepEqual(failing(bundle, "signature_text_binds"), [
    "bundle.signature_text_binds_request_and_response",
  ]);
});

test("a signature from an address no quote attested fails the address check", () => {
  const bundle = buildRedaction();
  bundle.signature.signing_address = `0x${"cd".repeat(20)}`;
  assert.equal(verifyRedactionBundle(bundle, NONCE).ok, false, summary(bundle));
  assert.deepEqual(failing(bundle, "signature_address_is_attested"), [
    "bundle.signature_address_is_attested",
  ]);
});

test("a bundle naming a model the quote never attested is not a pass", () => {
  const bundle = buildRedaction({ model: "fictional-lab/Other-Model" });
  assert.equal(verifyRedactionBundle(bundle, NONCE).ok, false, summary(bundle));
  assert.ok(failing(bundle, "attested_model_is_the_bundle_model").length > 0);
});

test("a signature of the wrong length fails the length check and nothing else", () => {
  const bundle = buildRedaction();
  bundle.signature.signature = `0x${"ab".repeat(64)}`;
  assert.equal(verifyRedactionBundle(bundle, NONCE).ok, false, summary(bundle));
  assert.deepEqual(failing(bundle, "signature_is"), ["bundle.signature_is_65_bytes"]);
});

test("a report made for a nonce the client did not choose fails the quote binding", () => {
  const bundle = buildRedaction({ attestation: buildBundle("44".repeat(32)) });
  assert.equal(verifyRedactionBundle(bundle, NONCE).ok, false, summary(bundle));
  assert.ok(failing(bundle, "quote_binds_our_nonce").length > 0);
});

test("a bundle that states a nonce other than the client's is caught without the report", () => {
  const bundle = buildRedaction({ nonce: "44".repeat(32) });
  assert.equal(verifyRedactionBundle(bundle, NONCE).ok, false, summary(bundle));
  assert.deepEqual(failing(bundle, "nonce_is_the_one_we_chose"), [
    "bundle.nonce_is_the_one_we_chose",
  ]);
});

test("a stored file with no report in it is a failed check, not a crash", () => {
  for (const attestation of [undefined, null, {}, { model_attestations: "not-an-array" }]) {
    const bundle = { ...buildRedaction(), attestation } as unknown as RedactionBundle;
    const result = verifyRedactionBundle(bundle, NONCE);
    assert.equal(result.ok, false, `a bundle with attestation ${JSON.stringify(attestation)} passed`);
    assert.deepEqual(result.checks.map((entry) => entry.name), ["bundle.attestation_report_present"]);
    assert.deepEqual(result.unchecked, UNCHECKED_ATTESTATION_CLAIMS);
  }
});

test("no check detail repeats the tipster's text", () => {
  const secret = "as the only procurement officer in the Lokoja annex";
  const bundle = buildRedaction({ request_text: JSON.stringify({ messages: [{ content: secret }] }) });
  const text = JSON.stringify(verifyRedactionBundle(bundle, NONCE).checks);
  assert.ok(!text.includes(secret), `a check detail quoted the plaintext: ${text}`);
});

test("a nonce that is not 32 lowercase hex bytes is the caller's bug", () => {
  for (const nonce of ["", "0".repeat(63), "0".repeat(65), "X".repeat(64), "0".repeat(32)]) {
    assert.throws(() => verifyRedactionBundle(buildRedaction(), nonce), RangeError, nonce);
  }
});

test("canonicalJson orders keys, drops undefined, and refuses what has no JSON form", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }] }), '{"a":[2,{"c":"x","d":null}],"b":1}');
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(canonicalJson([1, "2", true, null]), '[1,"2",true,null]');
  assert.throws(() => canonicalJson(undefined), RangeError, "a bundle with nothing in it has no hash");
  for (const unusable of [Number.NaN, Number.POSITIVE_INFINITY, () => 1, Symbol("s")]) {
    assert.throws(() => canonicalJson({ unusable }), RangeError, String(unusable));
  }
  assert.equal(canonicalJson({ unusable: undefined }), "{}", "an absent field must not be an error");
});

test("sha256Hex is sha256 over the UTF-8 bytes, lowercase, of a string", () => {
  assert.equal(
    sha256Hex("æ… b"),
    createHash("sha256").update(new TextEncoder().encode("æ… b")).digest("hex"),
  );
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.notEqual(sha256Hex("a"), sha256Hex("b"));
});
