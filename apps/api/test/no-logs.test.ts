// PRIVACY INVARIANT 2 (ARCHITECTURE §9, §12): no IP, no forwarding header, no body and no tipster
// identifier may ever reach a log. A request log with an address in it de-anonymises a tipster that the
// contract never saw an identity for, so this test does not check that the middleware ran - it checks
// what a handler could see and what a logger could write, on real traffic through the real app.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Hono } from "hono";

import { createRedactor } from "../src/ai/redact.js";
import { createApp } from "../src/app.js";
import { STRIPPED_HEADERS, noLogs } from "../src/middleware/no-logs.js";
import { createQueue } from "../src/relay/queue.js";
import { createRateLimiter } from "../src/relay/ratelimit.js";
import { aiRoutes } from "../src/routes/ai.js";
import { relayRoutes } from "../src/routes/relay.js";
import { memoryBlobStore } from "../src/store/blob.js";

const IP = "203.0.113.9";
const SECRET_BODY = "sealed-evidence-bytes-do-not-log-me";

/**
 * The real relay route over a queue that never sends and a chain that has no tips. The privacy point of
 * using the route rather than a stub is that `/relay` is the one endpoint a tipster posts a signed action
 * and a claim pubkey to, so it is the one body this test most needs to prove is not logged.
 */
const relayForTests = (): Hono =>
  relayRoutes({
    context: { contract: "sealedtip.testnet", tipReader: async () => null },
    limiter: createRateLimiter({ keyBurst: 10, keyPerSecond: 1, globalBurst: 10, globalPerSecond: 1 }),
    queue: createQueue({ delayMs: () => 60_000, send: async () => ({ txHash: "never" }) }),
  });

/**
 * The AI route over an upstream that answers. `/ai/redact` is the one endpoint where a tipster hands this
 * service the words themselves — the evidence, before it was ever sealed — so its body is what this test
 * has to cover now that the route exists. The fake cloud stands in for NEAR AI so it runs without a key.
 */
const aiForTests = (): Hono =>
  aiRoutes({
    redactor: createRedactor({
      defaultModel: "attested-model",
      bucket: { take: () => ({ allowed: true, retryAfterMs: 0 }) },
      cloud: {
        report: async () => ({ tee_reports: [] }),
        complete: async () => ({
          chatId: "chat-1",
          responseText: '{"choices":[{"message":{"content":"{}"}}]}',
        }),
        signature: async () => ({
          text: "attested-model:0:0",
          signing_address: "0x0000000000000000000000000000000000000000",
          signature: "0x00",
        }),
      },
    }),
  });

/** Everything a handler could have written, captured off the five sinks a Node process can log through. */
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

/** An app whose single route reports what it was handed, so "the handler never saw it" is observable. */
const probe = (): Hono => {
  const app = new Hono();
  app.use("*", noLogs);
  app.post("/probe", async (c) =>
    c.json({
      headers: Object.fromEntries(STRIPPED_HEADERS.map((name) => [name, c.req.header(name) ?? null])),
      body: await c.req.text(),
    }),
  );
  return app;
};

const forwardHeaders = (): Record<string, string> =>
  Object.fromEntries(STRIPPED_HEADERS.map((name, i) => [name, `${IP}:${1 + i}, 198.51.100.7`]));

test("every forwarding header is gone before the handler runs", async () => {
  const res = await probe().request("/probe", {
    method: "POST",
    headers: { ...forwardHeaders(), "content-type": "text/plain" },
    body: SECRET_BODY,
  });
  assert.equal(res.status, 200);
  const seen = (await res.json()) as { headers: Record<string, string | null> };
  for (const name of STRIPPED_HEADERS) {
    assert.equal(seen.headers[name], null, `${name} reached the handler: ${seen.headers[name]}`);
  }
});

test("stripping does not eat the body: the bytes a tipster uploaded still arrive", async () => {
  const res = await probe().request("/probe", {
    method: "POST",
    headers: forwardHeaders(),
    body: SECRET_BODY,
  });
  const seen = (await res.json()) as { body: string };
  assert.equal(seen.body, SECRET_BODY);
});

test("a request through the real app logs nothing at all, least of all an address", async () => {
  const app = createApp({ blobs: memoryBlobStore(1024), relay: relayForTests(), ai: aiForTests() });
  const { logged } = await captureLogs(async () => {
    await app.request("/health");
    await app.request("/blob", { method: "POST", body: new Uint8Array([1, 2, 3, 4]) });
    await app.request("/nope");
  });
  assert.equal(logged, "", `the API wrote to a console sink: ${logged}`);
});

// The relay body is the one request this service gets that carries a public key and a signature. Both are
// useless to an eavesdropper on their own, but a log line that shows the same pubkey posting to the blob
// store and to /relay is the linkage the 24-word identity exists to avoid — so this is checked as a
// property of the route, not of the handler that happens to be installed.
test("a signed action posted to /relay appears in no log and comes back in no error", async () => {
  const app = createApp({ blobs: memoryBlobStore(1024), relay: relayForTests(), ai: aiForTests() });
  const action = {
    tip_id: 7,
    nonce: 3,
    signature: Buffer.alloc(64, 9).toString("base64"),
  };
  const { result: res, logged } = await captureLogs(async () =>
    app.request("/relay/checkin", {
      method: "POST",
      headers: { ...forwardHeaders(), "content-type": "application/json" },
      body: JSON.stringify(action),
    }),
  );
  assert.equal(res.status, 404, "a tip the chain does not have must not be queued");
  const text = JSON.stringify(await res.json()) + logged;
  assert.equal(logged, "", `the API wrote to a console sink: ${logged}`);
  assert.ok(!text.includes(Buffer.alloc(64, 9).toString("base64")), "the refused signature came back");
  assert.ok(!text.includes(IP), `an address was logged: ${text}`);
});

test("an oversized upload is refused without the body being echoed into the response or a log", async () => {
  const app = createApp({ blobs: memoryBlobStore(4), relay: relayForTests(), ai: aiForTests() });
  const { result: res, logged } = await captureLogs(async () =>
    app.request("/blob", { method: "POST", body: new Uint8Array(64).fill(7) }),
  );
  assert.equal(res.status, 413);
  const text = JSON.stringify(await res.json()) + logged;
  assert.ok(!text.includes("777777"), `the refused body came back: ${text}`);
  assert.ok(!logged.includes(IP), `an address was logged: ${logged}`);
});

// `/ai/redact` is the one route that gets the tipster's words rather than bytes they sealed, so a leak here
// is the worst one this service can have. The upstream is a fake, which is also the point: a real call puts
// the text on NEAR AI's host — a linkage ARCHITECTURE §7 accepts and a log line would make permanent.
test("the text posted to /ai/redact reaches no log, not even on the request that succeeds", async () => {
  const app = createApp({ blobs: memoryBlobStore(1024), relay: relayForTests(), ai: aiForTests() });
  const { result: res, logged } = await captureLogs(async () =>
    app.request("/ai/redact", {
      method: "POST",
      headers: { ...forwardHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ text: SECRET_BODY, nonce: "ab".repeat(32) }),
    }),
  );
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(!logged.includes(SECRET_BODY), "the tipster's text was logged");
  assert.ok(!logged.includes(IP), `an address was logged: ${logged}`);
});

// The middleware can strip everything and still be undone by one handler that logs `c.req`. This is the
// part a behavioural test cannot reach, so it is checked in the source instead - and, like the rest of
// this file, it fails the moment someone adds the line it is banning.
const API_SOURCES = [
  "src/index.ts",
  "src/app.ts",
  "src/env.ts",
  "src/json.ts",
  "src/middleware/no-logs.ts",
  "src/routes/blob.ts",
  "src/routes/relay.ts",
  "src/routes/ai.ts",
  "src/routes/quote.ts",
  "src/ai/cloud.ts",
  "src/ai/redact.ts",
  "src/relay/gate.ts",
  "src/relay/queue.ts",
  "src/relay/ratelimit.ts",
  "src/relay/submit.ts",
  "src/store/blob.ts",
];

// `src/ai/cloud.ts` is the one file here that makes an outbound request, and the URL it builds carries the
// nonce the tipster chose. A `fetch` failure message can contain that URL, so the ban here is on printing an
// error object wholesale — the two AI files have to name what failed, not hand over what it failed on.
test("no api source may print a caught error object, only a message it chose to write", () => {
  for (const file of API_SOURCES) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!/console\.\w+\(\s*(error|err|cause)\s*[,)]/.test(text), `${file} logs a caught error`);
    assert.ok(!/console\.\w+\(.*\bc\b\s*[,)]/.test(text), `${file} logs a request context`);
  }
});

test("no route may import a request logger or hand a request object to a console sink", () => {
  for (const file of API_SOURCES) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!/hono\/middleware\/logger/.test(text), `${file} imports hono's request logger`);
    assert.ok(!/console\.\w+\(\s*(c\.req|req)\b/.test(text), `${file} logs a request object`);
  }
});

// PRIVACY INVARIANT 2's structural half. `project_structure.md` §5 says `apps/api` must not import
// `packages/crypto`, and the reason is not tidiness: that package is the one that holds sealed-box and
// XChaCha20 code, so an API that can reach it is an API that is one refactor away from being able to open
// an exhibit. The relay route is where that temptation actually arrives — the obvious way to check a
// tipster's signature server-side is to import `verify` — so the ban is checked here, in source, where a
// comment explaining it cannot be skipped.
//
// It matches import and export statements, not every mention. The AI proxy has to name the package in its
// comments to explain why it assembles the attestation bundle but never checks one, and a ban that punished
// that sentence would get the sentence deleted rather than the import refused.
const IMPORTS_CLIENT_PACKAGE =
  /^\s*(?:import|export)\b[^;\n]*["']@sealedtip\/(?:crypto|clean)["']|import\(\s*["']@sealedtip\/(?:crypto|clean)["']/m;

test("the API may not import client crypto or client cleaning", () => {
  for (const file of API_SOURCES) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!IMPORTS_CLIENT_PACKAGE.test(text), `${file} imports a client-side package`);
  }
});
