// S-8.5: `POST /ai/redact` as a tipster's browser calls it, through the real app, against a fake NEAR AI
// Cloud. The route is the one place this service both holds a key and sees plaintext, so the properties
// that matter are: the bytes it promises to have sent are the bytes that were sent, the nonce the tipster
// chose is the nonce the enclave was asked to bind, the answer is refused rather than cached, and a
// failure says what to retry without repeating what was asked.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Hono } from "hono";

import { createApp } from "../src/app.js";
import { nearAiCloud } from "../src/ai/cloud.js";
import { AI_LIMITS, AI_SYSTEM_PROMPT, AI_TEXT_MAX_BYTES, createRedactor, createTokenBucket } from "../src/ai/redact.js";
import { aiRoutes } from "../src/routes/ai.js";
import { readJson, type Json, type JsonObject } from "../src/json.js";
import { memoryBlobStore } from "../src/store/blob.js";

const KEY = "sk-fictional-not-a-real-key";
const MODEL = "fictional-lab/Fictional-Model-0001";
const NONCE = "cd".repeat(32);
const TEXT = "as the only procurement officer in the Lokoja annex, I signed the invoice on 4 March";

const REPORT: JsonObject = {
  gateway_attestation: { signing_address: "0xgateway" },
  model_attestations: [{ signing_address: "0xmodel", model_name: MODEL }],
};
const ANSWER = JSON.stringify({
  suggestions: [
    {
      span: "the only procurement officer in the Lokoja annex",
      reason: "one person holds that role in that office",
      replacement: "a procurement officer",
    },
  ],
  residual_risks: ["the date is combined with the invoice"],
});
const COMPLETION_TEXT = JSON.stringify({ id: "chat-1", choices: [{ message: { content: ANSWER } }] });
const SIGNATURE: JsonObject = {
  text: "signed-over-hashes",
  signing_address: "0xmodel",
  signature: `0x${"ab".repeat(65)}`,
  signing_algo: "ecdsa",
};

interface Bundle {
  version: number;
  nonce: string;
  model: string;
  request_text: string;
  response_text: string;
  attestation: Json;
  signature: Record<string, string>;
}

interface Reply {
  model?: string;
  chat_id?: string;
  suggestions?: { span: string; reason: string; replacement: string }[] | null;
  residual_risks?: string[];
  unparsed?: string | null;
  bundle?: Bundle;
  error?: string;
}

/** The three upstream answers a redaction call needs, each overridable with an object or an Error to throw. */
interface Replacements {
  report?: Json | Error;
  completion?: unknown;
  signature?: Json | Error;
}

const harness = (
  options: {
    replies?: Replacements;
    /** A deployment sets NEAR_AI_MODEL; the proxy then needs no model in the request. `noDefaultModel` is the case where nobody did. */
    noDefaultModel?: boolean;
    bucket?: ReturnType<typeof createTokenBucket>;
    configured?: boolean;
  } = {},
): { app: Hono; urls: string[]; bodies: string[] } => {
  const urls: string[] = [];
  const bodies: string[] = [];
  const replies = options.replies ?? {};

  const cloud = nearAiCloud({
    apiKey: KEY,
    base: "https://upstream.test",
    fetchFn: async (url, init) => {
      urls.push(url);
      const answer: unknown = url.includes("/attestation/report")
        ? (replies.report ?? REPORT)
        : url.includes("/chat/completions")
          ? (replies.completion ?? COMPLETION_TEXT)
          : (replies.signature ?? SIGNATURE);
      if (answer instanceof Error) throw answer;
      if (url.includes("/chat/completions")) bodies.push(String(init.body));
      const text = typeof answer === "string" ? answer : JSON.stringify(answer);
      return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const redactor =
    options.configured === false
      ? null
      : createRedactor({
          cloud,
          ...(options.noDefaultModel === true ? {} : { defaultModel: MODEL }),
          ...(options.bucket === undefined ? {} : { bucket: options.bucket }),
        });

  const ai = aiRoutes({ redactor });
  const app = createApp({ blobs: memoryBlobStore(1024), relay: new Hono(), ai });
  return { app, urls, bodies };
};

const redact = async (app: Hono, body: unknown): Promise<Response> =>
  await app.request("/ai/redact", { method: "POST", body: JSON.stringify(body) });

const reply = async (response: Response): Promise<Reply> => (await response.json()) as Reply;

const valid = { text: TEXT, nonce: NONCE };

test("a redaction request comes back with suggestions, the bundle and a no-store header", async () => {
  const h = harness();
  const response = await redact(h.app, valid);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await reply(response);
  assert.deepEqual(Object.keys(body).sort(), [
    "bundle",
    "chat_id",
    "model",
    "residual_risks",
    "suggestions",
    "unparsed",
  ]);
  assert.equal(body.chat_id, "chat-1");
  assert.equal(body.unparsed, null);
  assert.deepEqual(body.suggestions, JSON.parse(ANSWER).suggestions);
  assert.deepEqual(body.residual_risks, JSON.parse(ANSWER).residual_risks);
  assert.deepEqual(body.bundle?.attestation, REPORT, "the proxy edited somebody else's report on the way through");
});

test("the bundle has exactly the fields `@sealedtip/crypto`'s RedactionBundle reads", async () => {
  const body = await reply(await redact(harness().app, valid));
  const bundle = body.bundle!;
  // These two key lists are the wire format shared with `RedactionBundle` and `RedactionSignature`; the
  // verifier in packages/crypto is the typed version of them, and this app may not import it (§5).
  assert.deepEqual(Object.keys(bundle).sort(), [
    "attestation",
    "model",
    "nonce",
    "request_text",
    "response_text",
    "signature",
    "version",
  ]);
  assert.deepEqual(Object.keys(bundle.signature).sort(), [
    "chat_id",
    "signature",
    "signing_address",
    "signing_algo",
    "text",
  ]);
  assert.equal(bundle.version, 1);
  assert.equal(bundle.nonce, NONCE);
  assert.equal(bundle.model, MODEL);
});

test("the nonce the tipster chose is the nonce the enclave is asked to bind", async () => {
  const h = harness();
  await redact(h.app, valid);
  assert.match(h.urls[0]!, new RegExp(`nonce=${NONCE}`));
  const body = await reply(await redact(h.app, valid));
  assert.equal(body.bundle?.nonce, NONCE, "the bundle reported a nonce nobody chose");
});

test("the bytes stored in the bundle are the bytes that went to the model", async () => {
  const h = harness();
  const body = await reply(await redact(h.app, valid));
  const sent = h.bodies[0]!;
  assert.equal(body.bundle?.request_text, sent);
  assert.deepEqual(readJson(sent), {
    model: MODEL,
    messages: [
      { role: "system", content: AI_SYSTEM_PROMPT },
      { role: "user", content: TEXT },
    ],
  });
  // The signature is taken over sha256 of these exact bytes, so the response has to be stored as it arrived.
  assert.equal(body.bundle?.response_text, COMPLETION_TEXT);
  assert.equal(body.bundle?.signature.chat_id, "chat-1");
});

test("an unconfigured proxy refuses and spends nothing upstream", async () => {
  const h = harness({ configured: false });
  const response = await redact(h.app, valid);
  assert.equal(response.status, 503);
  assert.match((await reply(response)).error!, /not configured/);
  assert.deepEqual(h.urls, []);
});

test("a request that is not a text and a nonce is a 400 naming the field", async () => {
  const cases: [string, unknown][] = [
    ["no text", { nonce: NONCE }],
    ["empty text", { text: "", nonce: NONCE }],
    ["no nonce", { text: TEXT }],
    ["a nonce that is not 32 hex bytes", { text: TEXT, nonce: "cd".repeat(31) }],
    ["an uppercase nonce", { text: TEXT, nonce: NONCE.toUpperCase() }],
    ["a nonce that is not a string", { text: TEXT, nonce: 1 }],
    ["a text that is not a string", { text: 1, nonce: NONCE }],
  ];
  for (const [label, body] of cases) {
    const h = harness();
    const response = await redact(h.app, body);
    assert.equal(response.status, 400, `${label} → ${response.status}`);
    assert.match((await reply(response)).error!, /redact request|no model/, label);
    assert.deepEqual(h.urls, [], `${label} still reached the paid endpoint`);
  }
});

test("a text over the cap is refused for its bytes, and the answer names no content", async () => {
  const h = harness();
  // A euro sign is three UTF-8 bytes, so a character count is not a byte count and the cap has to be
  // checked against the bytes the model is paid to read.
  const over = "€".repeat(Math.floor(AI_TEXT_MAX_BYTES / 3) + 2);
  const response = await redact(h.app, { text: over, nonce: NONCE });
  assert.equal(response.status, 413, await response.clone().text());
  const error = (await reply(response)).error!;
  assert.match(error, new RegExp(`over the cap: ${over.length * 3} bytes, limit ${AI_TEXT_MAX_BYTES}`));
  assert.ok(!error.includes("€"), error);
  assert.deepEqual(h.urls, []);

  const fits = await redact(harness().app, { text: "€".repeat(Math.floor(AI_TEXT_MAX_BYTES / 3)), nonce: NONCE });
  assert.equal(fits.status, 200, await fits.clone().text());
});

test("a body over the envelope cap is refused before anything is parsed", async () => {
  const h = harness();
  const response = await h.app.request("/ai/redact", {
    method: "POST",
    body: `{"text":"${"a".repeat(AI_TEXT_MAX_BYTES + 10_000)}","nonce":"${NONCE}"}`,
  });
  assert.equal(response.status, 413);
  assert.match((await reply(response)).error!, /body over the cap/);
  assert.deepEqual(h.urls, []);
});

test("a body that is not JSON is a 400, not a crash", async () => {
  const response = await harness().app.request("/ai/redact", { method: "POST", body: "not json" });
  assert.equal(response.status, 400);
  assert.match((await reply(response)).error!, /expected a JSON body/);
});

test("a request with no model and no default is told which of the two to send", async () => {
  const bare = harness({ noDefaultModel: true });
  const response = await redact(bare.app, { text: TEXT, nonce: NONCE });
  assert.equal(response.status, 400);
  assert.match((await reply(response)).error!, /NEAR_AI_MODEL/);
  assert.deepEqual(bare.urls, [], "a request with no model to ask about still reached the paid endpoint");

  const named = await redact(harness({ noDefaultModel: true }).app, {
    text: TEXT,
    nonce: NONCE,
    model: "other/Model",
  });
  assert.equal(named.status, 200, await named.clone().text());
  assert.equal((await reply(named)).model, "other/Model");
});

test("the bucket refuses a flood with a Retry-After and spends nothing", async () => {
  let now = 0;
  const bucket = createTokenBucket({ burst: 2, perSecond: 1 / 60 }, () => now);
  const h = harness({ bucket });
  assert.equal((await redact(h.app, valid)).status, 200);
  assert.equal((await redact(h.app, valid)).status, 200);
  const refused = await redact(h.app, valid);
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("Retry-After")) > 0, "a 429 with no Retry-After");
  assert.equal(h.bodies.length, 2, "a refused request still paid for a completion");

  now += 61_000;
  assert.equal((await redact(h.app, valid)).status, 200);
});

test("the shipped limits are wider than one tipster's session and much narrower than a flood", () => {
  let now = 0;
  const bucket = createTokenBucket(AI_LIMITS, () => now);
  let allowed = 0;
  for (let i = 0; i < 100; i++) if (bucket.take().allowed) allowed += 1;
  assert.equal(allowed, AI_LIMITS.burst);
  now += 60_000;
  let afterAMinute = 0;
  for (let i = 0; i < 10; i++) if (bucket.take().allowed) afterAMinute += 1;
  assert.equal(afterAMinute, Math.round(AI_LIMITS.perSecond * 60));
});

test("an upstream failure is a 502 that names the endpoint and repeats nothing", async () => {
  for (const [label, replies] of [
    ["report", { report: new Error("attestation report exploded") }],
    ["completion", { completion: "" }],
    ["signature", { signature: new Error("signature service exploded") }],
  ] as [string, Replacements][]) {
    const h = harness({ replies });
    const response = await redact(h.app, valid);
    assert.equal(response.status, 502, `${label}: ${await response.clone().text()}`);
    const error = (await reply(response)).error!;
    assert.match(error, /ai upstream/, label);
    assert.ok(!error.includes(TEXT), `the tipster's text came back: ${error}`);
    assert.ok(!error.includes("exploded"), `an internal error string leaked: ${error}`);
  }
});

test("a service that 500s on the report costs no completion at all", async () => {
  const urls: string[] = [];
  const app = aiRoutes({
    redactor: createRedactor({
      cloud: nearAiCloud({
        apiKey: KEY,
        base: "https://upstream.test",
        fetchFn: async (url) => {
          urls.push(url);
          return new Response("nope", { status: 500 });
        },
      }),
      defaultModel: MODEL,
    }),
  });
  const response = await app.request("/redact", { method: "POST", body: JSON.stringify(valid) });
  assert.equal(response.status, 502);
  assert.equal(urls.length, 1, "the paid call happened after the free one failed");
  assert.match((await reply(response)).error!, /attestation report: HTTP 500/);
});

test("a signature response that does not state what §7.3 says it states is refused", async () => {
  for (const signature of [{}, { text: "only the text" }, { text: "t", signature: "0xab" }] as Json[]) {
    const response = await redact(harness({ replies: { signature } }).app, valid);
    assert.equal(response.status, 502, JSON.stringify(signature));
    const error = (await reply(response)).error!;
    assert.match(error, /did not state/, error);
    assert.ok(!error.includes("undefined"), error);
  }
});

test("a model that answers in prose still returns its bytes, unparsed", async () => {
  const response = await redact(
    harness({
      replies: { completion: { id: "chat-2", choices: [{ message: { content: "I would hide the office name." } }] } },
    }).app,
    valid,
  );
  assert.equal(response.status, 200);
  const body = await reply(response);
  assert.equal(body.suggestions, null);
  assert.deepEqual(body.residual_risks, []);
  assert.equal(body.unparsed, "I would hide the office name.");
  assert.ok(body.bundle!.request_text.includes("procurement"), "the bundle lost the text the tipster asked about");
});

test("a second identical request goes upstream again: the proxy keeps nothing", async () => {
  const h = harness();
  const first = await reply(await redact(h.app, valid));
  const second = await reply(await redact(h.app, valid));
  assert.equal(h.bodies.length, 2);
  assert.deepEqual(first, second, "two identical answers means one was remembered, and this service keeps nothing");
  const chatIds = h.urls.filter((url) => url.includes("/chat/completions"));
  assert.equal(chatIds.length, 2);
});

test("nothing about a redaction request reaches a log", async () => {
  const sinks = ["log", "info", "warn", "error", "debug"] as const;
  const original = sinks.map((name) => [name, console[name]] as const);
  const lines: string[] = [];
  for (const name of sinks) {
    (console as unknown as Record<string, unknown>)[name] = (...args: unknown[]): void => {
      lines.push(args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
    };
  }
  const h = harness();
  let status = 0;
  try {
    status = (await redact(h.app, valid)).status;
    await redact(h.app, { text: TEXT });
    await h.app.request("/ai/redact", { method: "GET" });
  } finally {
    for (const [name, fn] of original) {
      (console as unknown as Record<string, unknown>)[name] = fn;
    }
  }
  assert.equal(status, 200);
  assert.equal(lines.join("\n"), "", `the AI proxy wrote to a console sink: ${lines.join("\n")}`);
  assert.ok(!lines.join("\n").includes(KEY));
});

test("the only AI route is the proxy: nothing to ask what it kept", async () => {
  const h = harness();
  for (const path of ["/ai", "/ai/bundle", "/ai/redact/extra", "/ai/redact"]) {
    const response = await h.app.request(path, { method: "GET" });
    assert.equal(response.status, 404, `${path} → ${response.status}`);
  }
  const wrongMethod = await h.app.request("/ai/redact", { method: "GET" });
  assert.equal(wrongMethod.status, 404);
});
