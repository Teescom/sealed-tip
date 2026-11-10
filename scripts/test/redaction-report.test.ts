// The offline verifier's own contract (S-8.5, PRD F5): what `scripts/verify-attestation.ts --redaction`
// prints, and in what order. The checks themselves are graded in `packages/crypto/test/redaction.test.ts`;
// what could go wrong here is the wrapper — a hash that is not the bundle's, an extra chain check that is
// counted but never shown, or a detail line that repeats the tipster's words into a terminal and then into
// whoever screens-shotted it.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attestationHashOf,
  responseSignatureText,
  UNCHECKED_ATTESTATION_CLAIMS,
  type Check,
  type RedactionBundle,
} from "@sealedtip/crypto";

import { redactionReport, redactionReportLines } from "../lib/redaction-report.js";

const NONCE = "ab".repeat(32);
const MODEL = "qwen/qwen3-235b";
/** Standing in for the tipster's passage: the verifier's output must never contain it. */
const TIPSTER_TEXT = "the night-shift log names me by employee number 4471";

const bundle = (): RedactionBundle => ({
  version: 1,
  nonce: NONCE,
  model: MODEL,
  request_text: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: TIPSTER_TEXT }] }),
  response_text: '{"id":"chat-1","choices":[{"message":{"content":"{}"}}]}',
  attestation: { model_attestations: [] },
  signature: {
    chat_id: "chat-1",
    signing_algo: "ecdsa",
    signing_address: `0x${"11".repeat(20)}`,
    text: responseSignatureText(MODEL, TIPSTER_TEXT, ""),
    signature: `0x${"22".repeat(65)}`,
  },
});

const failing: Check = { name: "app_cert.chain", ok: false, detail: "no trusted root signed it" };

test("the hash the report prints is the bundle's own attestation hash", () => {
  const report = redactionReport(bundle(), NONCE);
  assert.equal(report.hash, attestationHashOf(bundle()));
  assert.match(report.hash, /^[0-9a-f]{64}$/);
});

test("the caller's chain checks are counted, not just appended for looks", () => {
  const withoutExtras = redactionReport(bundle(), NONCE);
  const withExtras = redactionReport(bundle(), NONCE, [failing]);
  assert.equal(withExtras.failed, withoutExtras.failed + 1);
  assert.ok(withExtras.checks.includes(failing), "the extra check is not in the list");
  const lines = redactionReportLines(withExtras);
  assert.ok(lines.some((line) => line.includes("app_cert.chain")), "the extra check was never printed");
});

test("the order a judge reads: verdicts, then the hash, then what is still unproven", () => {
  const lines = redactionReportLines(redactionReport(bundle(), NONCE, [failing]));
  const hashAt = lines.findIndex((line) => line.startsWith("attestation_hash "));
  const gapsAt = lines.findIndex((line) => line.startsWith("Not proven by this bundle"));
  assert.ok(hashAt > 0 && gapsAt > hashAt, `hash at ${hashAt}, gaps at ${gapsAt}`);
  assert.equal(lines[hashAt], `attestation_hash ${attestationHashOf(bundle())}`);
  const gaps = lines.slice(gapsAt + 1).filter((line) => line.trim().length > 0);
  assert.equal(gaps.length, UNCHECKED_ATTESTATION_CLAIMS.length);
  assert.deepEqual(gaps, UNCHECKED_ATTESTATION_CLAIMS.map((gap) => `  · ${gap}`));
});

test("a signature that does not bind the bytes it stored fails in the printed verdicts", () => {
  const tampered = bundle();
  tampered.signature.text = `${MODEL}:deadbeef:deadbeef`;
  const lines = redactionReportLines(redactionReport(tampered, NONCE));
  const binding = lines.find((line) => line.includes("signature_text_binds_request_and_response"));
  assert.ok(binding !== undefined && binding.startsWith("✘"), `not printed as a failure: ${binding}`);
});

// The curve check is scored now, so a bundle whose 65 bytes sign nothing has to print as a failure rather
// than as a gap — and the word the CLI prints on a clean run still has to be about bindings, not validity.
test("nothing calls an unverifiable signature verified", () => {
  const lines = redactionReportLines(redactionReport(bundle(), NONCE));
  const printed = lines.join("\n");
  const curve = lines.find((line) => line.includes("signature_recovers_from_the_signing_address_key"));
  assert.ok(curve !== undefined && curve.startsWith("✘"), `the curve check was not printed as a failure: ${curve}`);
  assert.ok(!/signature verified/i.test(printed), printed);
  assert.ok(!/✔ bundle.signature_recovers/.test(printed), "a curve check was scored as a pass");
});

test("no line of the verifier's output contains the tipster's passage", () => {
  const report = redactionReport(bundle(), NONCE, [failing]);
  const printed = redactionReportLines(report).join("\n");
  assert.ok(!printed.includes(TIPSTER_TEXT), "the request text was echoed");
  assert.ok(!printed.includes("4471"), "a number from inside the text was echoed");
});
