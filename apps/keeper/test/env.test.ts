// S-9.1–S-9.3 environment. The keeper is the service with the most damaging secrets in the repository —
// a key that completes a dead man's switch and a key that opens a bundle — so the two rules its startup
// message obeys are the same two the API's does: it names variables and never carries their values
// (AGENTS.md, "never log private keys"), and it refuses a config it cannot honour rather than running
// partly configured.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { type Env, loadEnv, parseEnv } from "../src/env.js";

const BASE: Record<string, string> = {
  NEAR_NETWORK: "testnet",
  NEAR_RPC_URL: "https://rpc.testnet.near.org",
  SEALEDTIP_CONTRACT: "sealedtip.st-hack-f8d075.testnet",
  KEEPER_ACCOUNT: "keeper.st-hack-f8d075.testnet",
  KEEPER_KEY: "ed25519:keeperFunctionCallKey",
  KEEPER_X25519_SECRET: "ab".repeat(32),
  KEEPER_API_URL: "http://localhost:8787",
};

const parse = (over: Record<string, string | undefined> = {}): Env => parseEnv({ ...BASE, ...over });

const failures = (source: Record<string, string | undefined>): string => {
  try {
    parseEnv(source);
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
  assert.fail("parseEnv accepted a config it should have refused");
};

test("the demo config is the smallest one that works, and the intervals are the documented defaults", () => {
  const env = parse();
  assert.equal(env.KEEPER_HEARTBEAT_S, 300);
  assert.equal(env.KEEPER_WATCH_S, 10);
});

test("every name the keeper reads is declared in .env.example", () => {
  const example = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  for (const name of Object.keys(BASE).concat(["KEEPER_HEARTBEAT_S", "KEEPER_WATCH_S"])) {
    assert.ok(example.includes(`${name}=`), `${name} is required by env.ts but not declared in .env.example`);
  }
});

test("mainnet is refused, because this repository deploys to testnet only", () => {
  assert.match(failures({ ...BASE, NEAR_NETWORK: "mainnet" }), /NEAR_NETWORK[\s\S]*testnet/);
});

test("a keeper key that is not a function-call key is refused by name, not by value", () => {
  const secret = "sk-SECRET-never-print-this";
  const message = failures({ ...BASE, KEEPER_KEY: secret });
  assert.match(message, /KEEPER_KEY/);
  assert.ok(!message.includes(secret), "the startup message echoed the key it refused");
});

test("an X25519 secret that is not 32 bytes is refused without quoting what it got", () => {
  for (const bad of ["ab".repeat(31), "zz".repeat(32), "0x" + "ab".repeat(32), ""]) {
    const message = failures({ ...BASE, KEEPER_X25519_SECRET: bad });
    assert.match(message, /KEEPER_X25519_SECRET/);
    assert.ok(!message.includes(bad.slice(0, 12)) || bad.length === 0, `the refused value appeared in: ${message}`);
  }
});

test("a watch interval above a minute is refused, because the row promises the minute", () => {
  assert.match(failures({ ...BASE, KEEPER_WATCH_S: "61" }), /KEEPER_WATCH_S[\s\S]*within a minute/);
  assert.equal(parse({ KEEPER_WATCH_S: "60" }).KEEPER_WATCH_S, 60);
});

test("a missing name is named, and the whole set of problems comes out at once", () => {
  const message = failures({ ...BASE, KEEPER_ACCOUNT: "", KEEPER_API_URL: "not a url" });
  assert.match(message, /2 problem\(s\)/);
  assert.match(message, /KEEPER_ACCOUNT/);
  assert.match(message, /KEEPER_API_URL/);
});

test("loadEnv reads the process environment, and nothing else", () => {
  const saved = process.env;
  try {
    process.env = { ...saved, ...BASE };
    assert.equal(loadEnv().KEEPER_ACCOUNT, BASE.KEEPER_ACCOUNT);
  } finally {
    process.env = saved;
  }
});
