// PRIVACY INVARIANT 2 (ARCHITECTURE §9, §12): no IP, no forwarding header, no body and no tipster
// identifier may ever reach a log. A request log with an address in it de-anonymises a tipster that the
// contract never saw an identity for, so this test does not check that the middleware ran - it checks
// what a handler could see and what a logger could write, on real traffic through the real app.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Hono } from "hono";

import { createApp } from "../src/app.js";
import { STRIPPED_HEADERS, noLogs } from "../src/middleware/no-logs.js";
import { memoryBlobStore } from "../src/store/blob.js";

const IP = "203.0.113.9";
const SECRET_BODY = "sealed-evidence-bytes-do-not-log-me";

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
  const app = createApp({ blobs: memoryBlobStore(1024) });
  const { logged } = await captureLogs(async () => {
    await app.request("/health");
    await app.request("/blob", { method: "POST", body: new Uint8Array([1, 2, 3, 4]) });
    await app.request("/nope");
  });
  assert.equal(logged, "", `the API wrote to a console sink: ${logged}`);
});

test("an oversized upload is refused without the body being echoed into the response or a log", async () => {
  const app = createApp({ blobs: memoryBlobStore(4) });
  const { result: res, logged } = await captureLogs(async () =>
    app.request("/blob", { method: "POST", body: new Uint8Array(64).fill(7) }),
  );
  assert.equal(res.status, 413);
  const text = JSON.stringify(await res.json()) + logged;
  assert.ok(!text.includes("777777"), `the refused body came back: ${text}`);
  assert.ok(!logged.includes(IP), `an address was logged: ${logged}`);
});

// The middleware can strip everything and still be undone by one handler that logs `c.req`. This is the
// part a behavioural test cannot reach, so it is checked in the source instead - and, like the rest of
// this file, it fails the moment someone adds the line it is banning.
test("no route may import a request logger or hand a request object to a console sink", () => {
  const sources = [
    "src/index.ts",
    "src/app.ts",
    "src/env.ts",
    "src/middleware/no-logs.ts",
    "src/routes/blob.ts",
    "src/routes/relay.ts",
    "src/routes/ai.ts",
    "src/routes/quote.ts",
    "src/store/blob.ts",
  ];
  for (const file of sources) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!/hono\/middleware\/logger/.test(text), `${file} imports hono's request logger`);
    assert.ok(!/console\.\w+\(\s*(c\.req|req)\b/.test(text), `${file} logs a request object`);
  }
});
