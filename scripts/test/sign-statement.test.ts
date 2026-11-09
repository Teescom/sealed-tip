// Identity statement signing and verification unit tests (S-6.13, Issue #104)
import assert from "node:assert/strict";
import { test } from "node:test";

import { newSecret, secretToWords } from "@sealedtip/crypto";

import { main, signStatement, verifyStatement } from "../sign-statement.js";

test("statement_round_trip", async () => {
  const secret = newSecret();
  const words = secretToWords(secret);
  const statement = "I hereby confirm that I submitted tip #42 regarding procurement fraud.";

  const signed = await signStatement(words, statement);
  assert.equal(signed.statement, statement);
  assert.equal(signed.publicKey.length, 32);
  assert.equal(signed.signature.length, 64);
  assert.equal(signed.publicKeyHex.length, 64);
  assert.equal(signed.signatureHex.length, 128);

  // Positive verification with raw Uint8Array
  assert.equal(verifyStatement(signed.publicKey, signed.signature, statement), true);

  // Positive verification with hex strings
  assert.equal(verifyStatement(signed.publicKeyHex, signed.signatureHex, statement), true);
  assert.equal(verifyStatement(`0x${signed.publicKeyHex}`, `0x${signed.signatureHex}`, statement), true);

  // Negative: altered statement
  assert.equal(verifyStatement(signed.publicKey, signed.signature, "I did NOT submit tip #42."), false);

  // Negative: tampered signature
  const tamperedSig = new Uint8Array(signed.signature);
  const firstByte = tamperedSig[0] ?? 0;
  tamperedSig[0] = firstByte ^ 1;
  assert.equal(verifyStatement(signed.publicKey, tamperedSig, statement), false);

  // Negative: wrong public key
  const otherSecret = newSecret();
  const otherSigned = await signStatement(secretToWords(otherSecret), statement);
  assert.equal(verifyStatement(otherSigned.publicKey, signed.signature, statement), false);

  // CLI main round-trip
  let output = "";
  const originalLog = console.log;
  console.log = (msg: string) => {
    output += `${msg}\n`;
  };
  try {
    const signExit = await main(["--words", words.join(" "), "--statement", statement, "--json"]);
    assert.equal(signExit, 0);
    const parsed = JSON.parse(output) as { public_key: string; signature: string; statement: string };
    assert.equal(parsed.statement, statement);
    assert.equal(parsed.public_key, signed.publicKeyHex);
    assert.equal(parsed.signature, signed.signatureHex);

    const verifyExit = await main([
      "--verify",
      "--pubkey",
      parsed.public_key,
      "--signature",
      parsed.signature,
      "--statement",
      statement,
    ]);
    assert.equal(verifyExit, 0);

    const badVerifyExit = await main([
      "--verify",
      "--pubkey",
      parsed.public_key,
      "--signature",
      parsed.signature,
      "--statement",
      "different statement",
    ]);
    assert.equal(badVerifyExit, 1);
  } finally {
    console.log = originalLog;
  }
});
