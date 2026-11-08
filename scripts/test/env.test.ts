// `.env` is the deployment config, so reading and rewriting it is the part of the scripts a typo in
// would otherwise show up as a wrong deposit on testnet.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { assertTestnet, loadEnv, optionalVar, parseDotEnv, patchEnvText, requireVar, saveEnv } from "../lib/env.js";

const SAMPLE = [
  "# a comment",
  "export A=1",
  "B = 2",
  'C="quoted value"   # trailing note',
  "D='single'",
  "E=",
  "not-an-assignment",
  "F=value # note",
  "G=1234567890123456789012345",
].join("\n");

test("parseDotEnv reads the forms .env.example uses", () => {
  const env = parseDotEnv(SAMPLE);
  assert.equal(env["A"], "1", "`export ` is stripped");
  assert.equal(env["B"], undefined, "`B = 2` has a space in the key, so it is not a key");
  assert.equal(env["C"], "quoted value", "double quotes win over the trailing comment");
  assert.equal(env["D"], "single");
  assert.equal(env["E"], "", "a declared-but-empty var is present and empty, which requireVar treats as missing");
  assert.equal(env["not-an-assignment"], undefined);
  assert.equal(env["F"], "value", "an unquoted ` # …` is a comment");
  assert.equal(env["G"], "1234567890123456789012345", "a yoctoNEAR amount survives as text, not a float");
});

test("patchEnvText rewrites values and keeps every other byte", () => {
  const patched = patchEnvText(SAMPLE, { A: "9", NEW: "x" });
  const env = parseDotEnv(patched);
  assert.equal(env["A"], "9");
  assert.equal(env["NEW"], "x");
  assert.ok(patched.includes("# a comment"), "comments are not collateral");
  assert.ok(patched.includes('C="quoted value"   # trailing note'), "untouched lines are byte-identical");
  assert.ok(patched.endsWith("\n"));
  assert.throws(() => patchEnvText(SAMPLE, { "not a name": "1" }), RangeError);
});

test("requireVar treats empty as missing and optionalVar does not", () => {
  const env = parseDotEnv("SET=1\nBLANK=\n");
  assert.equal(requireVar(env, "SET"), "1");
  assert.throws(() => requireVar(env, "BLANK"), /missing BLANK/);
  assert.throws(() => requireVar(env, "ABSENT"), /missing ABSENT/);
  assert.equal(optionalVar(env, "BLANK", "fallback"), "fallback");
  assert.equal(optionalVar(env, "ABSENT", "fallback"), "fallback");
  assert.equal(optionalVar(env, "SET", "fallback"), "1");
});

test("AGENTS.md: only testnet gets past assertTestnet", () => {
  assert.doesNotThrow(() => assertTestnet("testnet"));
  for (const network of ["mainnet", "betanet", "sandbox", "", "TESTNET"]) {
    assert.throws(() => assertTestnet(network), /testnet-only/, network);
  }
});

test("saveEnv writes back only what changed, at 0600", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sealedtip-env-")), ".env");
  writeFileSync(path, `${SAMPLE}\n`, { mode: 0o600 });

  assert.deepEqual(saveEnv(path, { A: "1", NEW: "2" }), ["NEW"], "an unchanged key is not reported as written");
  assert.equal(parseDotEnv(readFileSync(path, "utf8"))["NEW"], "2");
  assert.deepEqual(saveEnv(path, { NEW: "2" }), [], "a second run of the same write changes nothing");
  assert.equal(statSync(path).mode & 0o777, 0o600, "this file holds private keys");
});

// ENV_FILE is the override that lets a linked worktree point at the main checkout's `.env`, so these
// tests set it rather than depend on whatever the machine happens to export.
test("loadEnv reads ENV_FILE, and names the path it looked at when there is no .env", () => {
  const dir = mkdtempSync(join(tmpdir(), "sealedtip-env-"));
  const other = join(dir, "elsewhere");
  const path = join(dir, ".env");
  writeFileSync(path, "A=1\n", { mode: 0o600 });
  process.env["ENV_FILE"] = path;
  try {
    assert.deepEqual(loadEnv(other), { path, env: { A: "1" } }, "ENV_FILE wins over the root it was handed");
  } finally {
    delete process.env["ENV_FILE"];
  }
  assert.throws(
    () => loadEnv(other),
    (error: unknown) => (error as Error).message.includes(`no .env at ${join(other, ".env")}`),
    "the message says which file it wanted",
  );
});
