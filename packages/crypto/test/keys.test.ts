// Claim-secret derivation (S-6.3): the tipster's 24 words must always give back the same keys.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ED25519_LABEL,
  X25519_LABEL,
  deriveKeys,
  newSecret,
  newX25519KeyPair,
  secretToWords,
  sign,
  verify,
  wordsToSecret,
  x25519PublicKey,
} from "../src/index.js";
import { bytes, fixture, keyVector } from "./fixture.js";

const asArray = (value: Uint8Array): number[] => Array.from(value);

test("fixture labels match the code", () => {
  assert.equal(fixture.hkdf_labels.ed25519, ED25519_LABEL);
  assert.equal(fixture.hkdf_labels.x25519, X25519_LABEL);
});

test("each key vector: 24 words, and the words return the same secret", () => {
  for (const vector of fixture.keys) {
    assert.equal(vector.words.length, 24, vector.name);
    const secret = bytes(vector.secret);
    assert.deepEqual(asArray(wordsToSecret(secretToWords(secret))), asArray(secret), vector.name);
    assert.deepEqual(asArray(wordsToSecret(vector.words)), asArray(secret), vector.name);
  }
});

test("deriving from the fixture secrets reproduces the fixture keys", async () => {
  for (const vector of fixture.keys) {
    const derived = await deriveKeys(bytes(vector.secret), vector.passphrase ?? undefined);
    assert.deepEqual(asArray(derived.ed25519.secretKey), vector.ed25519_secret, vector.name);
    assert.deepEqual(asArray(derived.ed25519.publicKey), vector.ed25519_public_key, vector.name);
    assert.deepEqual(asArray(derived.x25519.secretKey), vector.x25519_secret, vector.name);
    assert.deepEqual(asArray(derived.x25519.publicKey), vector.x25519_public_key, vector.name);
  }
});

test("no passphrase and an empty passphrase derive the same keys", async () => {
  const secret = bytes(keyVector("no-passphrase").secret);
  const bare = await deriveKeys(secret);
  const empty = await deriveKeys(secret, "");
  assert.deepEqual(asArray(bare.ed25519.publicKey), asArray(empty.ed25519.publicKey));
  assert.deepEqual(asArray(bare.x25519.publicKey), asArray(empty.x25519.publicKey));
});

test("a different passphrase gives a different key — and the wrong one never recovers it", async () => {
  const guarded = keyVector("with-passphrase");
  const secret = bytes(guarded.secret);
  const right = await deriveKeys(secret, "baobab-mango-2026");
  const wrong = await deriveKeys(secret, "baobab-mango-2025");
  const none = await deriveKeys(secret);
  assert.deepEqual(asArray(right.ed25519.publicKey), guarded.ed25519_public_key);
  assert.notDeepEqual(asArray(wrong.ed25519.publicKey), guarded.ed25519_public_key);
  assert.notDeepEqual(asArray(none.ed25519.publicKey), guarded.ed25519_public_key);
});

test("derivation is deterministic and the two labels never collide", async () => {
  const secret = newSecret();
  const first = await deriveKeys(secret, "same");
  const second = await deriveKeys(secret, "same");
  assert.deepEqual(asArray(first.ed25519.publicKey), asArray(second.ed25519.publicKey));
  assert.notDeepEqual(asArray(first.ed25519.secretKey), asArray(first.x25519.secretKey));
  assert.equal(first.ed25519.secretKey.length, 32);
  assert.equal(first.x25519.publicKey.length, 32);
});

test("the whole chain holds: words → HKDF → ed25519 → the signature Rust will check", async () => {
  const vector = keyVector("no-passphrase");
  const derived = await deriveKeys(bytes(vector.secret));
  assert.deepEqual(asArray(derived.ed25519.publicKey), vector.ed25519_public_key);
  for (const action of fixture.vectors.filter((entry) => entry.key === vector.name)) {
    assert.deepEqual(asArray(sign(bytes(action.message), derived.ed25519.secretKey)), action.signature, action.name);
    assert.ok(verify(bytes(action.signature), bytes(action.message), derived.ed25519.publicKey), action.name);
  }
});

test("bad input is refused, not silently accepted", async () => {
  assert.throws(() => secretToWords(new Uint8Array(16)), RangeError);
  await assert.rejects(() => deriveKeys(new Uint8Array(16)), RangeError);
  assert.throws(() => wordsToSecret(["abandon"]));
  assert.throws(() => wordsToSecret(fixture.keys[0]!.words.slice(0, 12)));
  assert.throws(() => wordsToSecret([...fixture.keys[0]!.words, "not-a-bip39-word"]));

  // 24 words with the last one replaced: the checksum must reject almost all of them.
  const head = fixture.keys[0]!.words.slice(0, 23);
  const accepted = ["zoo", "abandon", "waste", "wagon", "wrist"].filter((word) => {
    try {
      wordsToSecret([...head, word]);
      return true;
    } catch {
      return false;
    }
  });
  assert.ok(accepted.length <= 1, `tampered mnemonics accepted: ${accepted.join(", ")}`);
});

test("newSecret returns 32 fresh bytes", () => {
  const a = newSecret();
  const b = newSecret();
  assert.equal(a.length, 32);
  assert.notDeepEqual(asArray(a), asArray(b));
});

// The keeper's and each panel member's public half is what the contract stores as `[u8; 32]`, so a
// deployment that registers a key it cannot reproduce has sealed every submission into the dark.
test("x25519PublicKey is the half deriveKeys returns, on its own", async () => {
  for (const vector of fixture.keys) {
    assert.deepEqual(asArray(await x25519PublicKey(bytes(vector.x25519_secret))), vector.x25519_public_key, vector.name);
  }
  await assert.rejects(() => x25519PublicKey(new Uint8Array(31)), RangeError);
});

// `scripts/lib/keys.ts` mints a deployment's keeper and panel keys with this, then stores the secret
// and registers the public half, so the two must agree or the sealed submissions never open.
test("a fresh X25519 pair is internally consistent and fresh every time", async () => {
  const first = await newX25519KeyPair();
  const second = await newX25519KeyPair();
  assert.equal(first.secretKey.length, 32);
  assert.deepEqual(asArray(await x25519PublicKey(first.secretKey)), asArray(first.publicKey));
  assert.notDeepEqual(asArray(first.publicKey), asArray(second.publicKey));
});
