// S-8.2: the API must refuse to start on a config it cannot honour, and the message it dies with is the
// one thing guaranteed to end up in a deploy log — so it may name variables and never carry their values.
// `.env.example` is the source of truth here (ARCHITECTURE §13), including its habit of declaring every
// optional name with an empty value, which has to mean "off" rather than "invalid".
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadEnv, parseEnv, type Env } from "../src/env.js";

const BASE: Record<string, string> = {
  NEAR_NETWORK: "testnet",
  NEAR_RPC_URL: "https://rpc.testnet.near.org",
  SEALEDTIP_CONTRACT: "sealedtip.st-hack-f8d075.testnet",
  RELAYER_A_ACCOUNT: "rel1.st-hack-f8d075.testnet",
  RELAYER_A_KEY: "ed25519:relayerA",
  RELAYER_B_ACCOUNT: "rel2.st-hack-f8d075.testnet",
  RELAYER_B_KEY: "ed25519:relayerB",
};

const parse = (over: Record<string, string | undefined> = {}): Env => parseEnv({ ...BASE, ...over });

/** The names that must never appear in an error, with a value that would identify the deployment if it did. */
const SECRET_NAMES = ["RELAYER_A_KEY", "RELAYER_B_KEY", "NEAR_AI_API_KEY", "ONECLICK_API_KEY", "BLOB_TOKEN"];

const failures = (source: Record<string, string | undefined>): string => {
  try {
    parseEnv(source);
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
  assert.fail("parseEnv accepted a config it should have refused");
};

test("the demo config is the smallest one that works, and the rest are defaults", () => {
  const env = parse();
  assert.equal(env.API_PORT, 8787);
  assert.equal(env.RELAY_DELAY_MIN_S, 0);
  assert.equal(env.RELAY_DELAY_MAX_S, 20);
  assert.equal(env.BLOB_MAX_BYTES, 26_214_400);
  assert.equal(env.NEAR_NETWORK, "testnet");
  assert.equal(env.NEAR_AI_API_KEY, undefined, "the AI proxy is off until the owner provides a key (S-0.3)");
  assert.equal(env.ONECLICK_API_KEY, undefined, "and the quote proxy until real money is approved (S-0.6)");
});

test("every number is read out of a string, in the units .env says it is in", () => {
  const env = parse({ API_PORT: "3000", RELAY_DELAY_MIN_S: "3600", RELAY_DELAY_MAX_S: "86400", BLOB_MAX_BYTES: "1048576" });
  assert.equal(env.API_PORT, 3000);
  assert.equal(env.RELAY_DELAY_MIN_S, 3600);
  assert.equal(env.BLOB_MAX_BYTES, 1048576);
});

test("a required name that is missing, or present and empty, stops the run and is named", () => {
  for (const name of Object.keys(BASE)) {
    const gone = failures({ ...BASE, [name]: undefined });
    assert.match(gone, new RegExp(name), `${name} missing was not reported by name`);
    const blank = failures({ ...BASE, [name]: "" });
    assert.match(blank, new RegExp(name), `${name}="" was not reported by name`);
  }
  assert.doesNotThrow(() => parse());
});

test("an optional name declared empty in .env.example means off, not broken", () => {
  const env = parse({ BLOB_STORE_URL: "", BLOB_TOKEN: "", NEAR_AI_API_KEY: "", NEAR_AI_MODEL: "", ONECLICK_API_KEY: "" });
  assert.equal(env.BLOB_STORE_URL, undefined);
  assert.equal(env.BLOB_TOKEN, undefined);
  assert.equal(env.NEAR_AI_API_KEY, undefined);
  assert.equal(env.ONECLICK_API_KEY, undefined);
});

test("values never appear in the message that names them", () => {
  const canaries: Record<string, string> = {
    RELAYER_A_KEY: "ed25519:SECRET-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    RELAYER_B_KEY: "ed25519:SECRET-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    NEAR_AI_API_KEY: "SECRET-near-ai-cccccccccccccccccccccccc",
    ONECLICK_API_KEY: "SECRET-1click-dddddddddddddddddddddddd",
    BLOB_TOKEN: "vblob_SECRET-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  };
  // One bad name is enough to kill the start, and the five secrets are set, valid and present throughout.
  for (const broken of ["SEALEDTIP_CONTRACT", "RELAYER_A_ACCOUNT", "NEAR_RPC_URL", "RELAYER_B_KEY"]) {
    const message = failures({ ...BASE, ...canaries, [broken]: broken === "RELAYER_B_KEY" ? "" : undefined });
    assert.match(message, new RegExp(broken), `the message did not name ${broken}: ${message}`);
    for (const name of SECRET_NAMES) {
      assert.ok(!message.includes(canaries[name]!), `${name} was printed in the startup error: ${message}`);
    }
  }
});

test("mainnet is refused by the API itself, not only by AGENTS.md", () => {
  const message = failures({ ...BASE, NEAR_NETWORK: "mainnet" });
  assert.match(message, /NEAR_NETWORK/);
  assert.match(message, /owner/);
  assert.equal(parse({ NEAR_NETWORK: "testnet" }).NEAR_NETWORK, "testnet");
  // A typo in the same name must not be reported as if someone had asked for mainnet.
  assert.doesNotMatch(failures({ ...BASE, NEAR_NETWORK: "Testnet" }), /only ever deploys to testnet/);
});

test("a relay queue whose delay cannot vary has no timing privacy to lose", () => {
  assert.doesNotThrow(() => parse({ RELAY_DELAY_MIN_S: "60", RELAY_DELAY_MAX_S: "60" }));
  const message = failures({ ...BASE, RELAY_DELAY_MIN_S: "3600", RELAY_DELAY_MAX_S: "60" });
  assert.match(message, /RELAY_DELAY_MIN_S/);
  assert.match(message, /RELAY_DELAY_MAX_S/);
  assert.throws(() => parse({ ...BASE, RELAY_DELAY_MIN_S: "-1" }), /RELAY_DELAY_MIN_S/);
});

test("a blob store URL with no token is a deployment that will fail on the first upload", () => {
  assert.throws(() => parse({ ...BASE, BLOB_STORE_URL: "https://blob.example.com/v1" }), /BLOB_TOKEN/);
  const both = parse({ BLOB_STORE_URL: "https://blob.example.com/v1", BLOB_TOKEN: "whatever" });
  assert.equal(both.BLOB_STORE_URL, "https://blob.example.com/v1");
  const garbage = failures({ ...BASE, BLOB_STORE_URL: "not-a-url" });
  assert.match(garbage, /BLOB_STORE_URL/);
  assert.doesNotMatch(garbage, /BLOB_TOKEN/, "a URL that did not parse must not also demand a token");
});

test("ports and byte counts are checked, because a typo here is a store that refuses everything", () => {
  for (const port of ["0", "65536", "abc", "8787.5", "1e9"]) {
    assert.throws(() => parse({ ...BASE, API_PORT: port }), /API_PORT/, port);
  }
  for (const bytes of ["0", "-1", "25mb"]) {
    assert.throws(() => parse({ ...BASE, BLOB_MAX_BYTES: bytes }), /BLOB_MAX_BYTES/, bytes);
  }
});

test("the count in the header line is the count of problems, so a fix-one-run-again loop ends", () => {
  const message = failures({ NEAR_NETWORK: "testnet" });
  const listed = message.split("\n").filter((line) => line.trimStart().startsWith("- "));
  assert.match(message, new RegExp(`^environment is not usable — ${listed.length} problem\\(s\\)`));
  assert.ok(listed.length >= 6, `a config missing seven names produced ${listed.length}: ${message}`);
  assert.match(message, /\.env\.example/);
});

test("loadEnv takes the record you hand it, so a test never reads the real .env", () => {
  assert.deepEqual(loadEnv({ ...BASE }), parse());
  assert.throws(() => loadEnv({}), /environment is not usable/);
});
