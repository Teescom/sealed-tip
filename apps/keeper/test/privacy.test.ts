// The keeper holds the two secrets that can turn a dead man's switch into a released tip: the function-call
// key that posts a release, and the X25519 secret that opens `K_switch`. AGENTS.md makes "never log a
// private key" a rule, and this process is where it is hardest to keep, because the key is not merely
// present — it is used, in memory, on the happy path.
//
// So this suite does what `apps/api/test/no-logs.test.ts` does for the API: it runs the real thing and
// reads back what a log would have got, rather than trusting that the code as written is careful. It also
// checks the two structural promises the keeper makes: that its write surface is exactly the two methods
// ARCHITECTURE §5 gives it, and that the type-level allow-list is still the one the source uses.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { fromHex, x25519PublicKey } from "@sealedtip/crypto";

import { beat } from "../src/heartbeat.js";
import { KEEPER_METHODS } from "../src/near.js";
import { release } from "../src/release.js";
import { startWatch } from "../src/watch.js";

import { fakeChain, lateHandle, makeTip, newMembers, sealKeeperCopy } from "./support.js";

/**
 * Everything a Node process can write to, captured. The same five sinks `no-logs.test.ts` watches, for the
 * same reason: a `console.debug` left in a file is still a log line in production.
 */
const captureLogs = async <T>(write: () => Promise<T>): Promise<{ result: T; logged: string }> => {
  const sinks = ["log", "info", "warn", "error", "debug"] as const;
  const original = sinks.map((name) => [name, console[name]] as const);
  const lines: string[] = [];
  for (const name of sinks) {
    (console as unknown as Record<string, unknown>)[name] = (...args: unknown[]): void => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  }
  try {
    return { result: await write(), logged: lines.join("\n") };
  } finally {
    for (const [name, fn] of original) {
      (console as unknown as Record<string, unknown>)[name] = fn;
    }
  }
};

const SOURCES = readdirSync(new URL("../src", import.meta.url)).filter((name) => name.endsWith(".ts"));

const KEEPER_SECRET = fromHex("cd".repeat(32));
const SWITCH_KEY = fromHex("ef".repeat(32));

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const setup = async () => {
  const members = await newMembers(3);
  const chain = fakeChain(members);
  // The keeper's public half is derived from its secret, the way `index.ts` derives it: a box sealed to a
  // key this process does not hold would not open, and the release path is the thing under test.
  const keeper = { secret: KEEPER_SECRET, publicKey: await x25519PublicKey(KEEPER_SECRET) };

  const cid = await sealKeeperCopy(SWITCH_KEY, keeper.publicKey, chain.blobs);
  const tip = { ...makeTip(0, { keeperCid: cid }) };
  tip.switch = { ...tip.switch!, triggered: true };
  chain.tips.set(0, tip);

  return {
    chain,
    members,
    keeper,
    deps: { views: chain.views, blobs: chain.blobs, call: chain.call, keeperX25519: keeper },
  };
};

test("a heartbeat, a watch pass and a real release log no key material", async () => {
  const { chain, members, keeper, deps } = await setup();

  const { logged } = await captureLogs(async () => {
    let passes = 0;
    const box = lateHandle();
    const running = startWatch({
      views: chain.views,
      sleep: async () => {
        passes += 1;
        if (passes >= 2) box.current?.stop();
      },
      onTriggered: async (tipId) => {
        const outcome = await release(tipId, deps);
        console.log("skipped" in outcome ? `kept: tip ${tipId}` : `released tip ${tipId} to ${outcome.posted.length}`);
      },
    });
    box.current = running;
    await running.done;
    await beat(chain.call);
  });

  // One release and the closing `beat` — two transactions, and the second is the liveness call the test
  // makes after the watch stops.
  assert.deepEqual(
    chain.calls.map((call) => call.method),
    ["post_released_keys", "heartbeat"],
    "the keeper sent something other than a release and a heartbeat",
  );
  const material = [
    hex(KEEPER_SECRET),
    base64(KEEPER_SECRET),
    hex(SWITCH_KEY),
    base64(SWITCH_KEY),
    ...members.flatMap((member) => [hex(member.keyPair.secretKey), base64(member.keyPair.secretKey)]),
  ];
  for (const secret of material) {
    assert.ok(!logged.includes(secret), `a key appeared in what the keeper logged: ${secret.slice(0, 8)}…`);
  }
  assert.equal(keeper.publicKey.length, 32);
});

test("a failed release says what went wrong without quoting the box it could not open", async () => {
  const { chain, deps } = await setup();
  const wrong = { publicKey: fromHex("bb".repeat(32)), secret: fromHex("aa".repeat(32)) };

  const { logged, result } = await captureLogs(async () => {
    try {
      await release(0, { ...deps, keeperX25519: wrong });
      return "released";
    } catch (error) {
      console.error(`keeper: ${error instanceof Error ? error.message : String(error)}`);
      return "refused";
    }
  });

  assert.equal(result, "refused");
  assert.equal(chain.calls.length, 0);
  assert.match(logged, /did not open with this keeper's X25519 secret/);
  assert.ok(!logged.includes(hex(SWITCH_KEY)), "the key the keeper could not open was printed anyway");
  assert.ok(!logged.includes(base64(SWITCH_KEY)));
});

test("the keeper's write surface is the two methods ARCHITECTURE §5 gives it", () => {
  assert.deepEqual([...KEEPER_METHODS].sort(), ["heartbeat", "post_released_keys"]);

  for (const name of SOURCES) {
    const text = readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/call\(\s*"([a-z_]+)"/g)) {
      const method = match[1];
      if (method === undefined) continue;
      assert.ok(
        (KEEPER_METHODS as readonly string[]).includes(method),
        `${name} calls ${method}, which is not on the keeper's allow-list`,
      );
    }
  }
});

test("no keeper source hands a key, a box or a plaintext to a log call", () => {
  const FORBIDDEN = /console\.\w+\([^)]*\b(secret|secretKey|switchKey|SWITCH_KEY|KEEPER_X25519|box|bytes)\b/;
  for (const name of SOURCES) {
    const text = readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      assert.ok(!FORBIDDEN.test(line), `${name}: ${line.trim()} logs something a key could be named by`);
    }
  }
});

test("the keeper does not read the environment anywhere but env.ts and index.ts", () => {
  for (const name of SOURCES) {
    if (name === "env.ts" || name === "index.ts") continue;
    const text = readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
    assert.ok(!text.includes("process.env"), `${name} reads the environment behind the validated config`);
  }
});
