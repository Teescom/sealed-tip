// base58 and the code hash are the two places where a script decides "this is the same contract", so
// they are checked against the DAO wasm this repository pinned and the provenance note written beside
// it — not against a number typed into this file.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DAO_WASM } from "../lib/dao.js";
import { EMPTY_CODE_HASH, base58, codeHashOf } from "../lib/near.js";
import { workspaceRoot } from "../lib/env.js";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
};

const note = (key: string): string => {
  const line = readFileSync(join(workspaceRoot(), "contracts", "sealedtip", "res", "SPUTNIK_VERSION.txt"), "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith(key));
  if (line === undefined) throw new Error(`SPUTNIK_VERSION.txt has no ${key} line`);
  return line.slice(key.length).trim();
};

test("base58 is NEAR's alphabet, with leading zero bytes as '1's", () => {
  assert.equal(base58(new Uint8Array(32)), EMPTY_CODE_HASH);
  assert.equal(base58(bytes("0001")), "12");
  assert.equal(base58(bytes("ff")), "5Q");
  assert.equal(base58(bytes("61")), "2g", "97 is one 58 and 39 left over");

  // The alphabet skips O, I, l and 0 so an account id or code hash cannot be misread by eye.
  const everyByte = Array.from({ length: 256 }, (_, i) => base58(Uint8Array.from([i]))).join("");
  for (const letter of ["O", "I", "l", "0"]) {
    assert.ok(!everyByte.includes(letter), `base58 should never print ${letter}`);
  }
});

test("codeHashOf is sha256 of the bytes, printed in base58", () => {
  const wasm = bytes("0061736d01000000");
  const digest = new Uint8Array(createHash("sha256").update(wasm).digest());
  assert.equal(codeHashOf(wasm), base58(digest));
  assert.equal(codeHashOf(new Uint8Array(0)), base58(new Uint8Array(createHash("sha256").update(new Uint8Array(0)).digest())));
});

test("the pinned Sputnik wasm still matches its own provenance note", () => {
  const wasm = new Uint8Array(readFileSync(join(workspaceRoot(), DAO_WASM)));
  assert.equal(wasm.length, Number(note("size_bytes:")));
  assert.equal(
    createHash("sha256").update(wasm).digest("hex"),
    note("sha256:"),
    "S-0.7 matched these bytes to six independently-owned testnet DAOs",
  );
  assert.equal(codeHashOf(wasm), note("on_chain_code_hash:"), "the code hash is how a deploy recognises the audited build");
});
