// S-8.5 transport: the three NEAR AI Cloud calls, checked against a fake fetch rather than production.
// What is worth testing here is what a proxy gets wrong quietly: the bytes it says it sent, the places a
// bearer key is and is not sent, a model id that is really a query-parameter injection, and an upstream
// that stops answering.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOUD_API,
  UpstreamError,
  completionContent,
  nearAiCloud,
  type Cloud,
} from "../src/ai/cloud.js";

const KEY = "sk-fictional-not-a-real-key";

interface Sent {
  url: string;
  init: RequestInit;
}

const harness = (
  replies: {
    report?: Response;
    completion?: Response;
    signature?: Response;
    on?: (sent: Sent) => Response;
  } = {},
  options: { timeoutMs?: number } = {},
): { cloud: ReturnType<typeof nearAiCloud>; sent: Sent[] } => {
  const calls: Sent[] = [];
  const cloud = nearAiCloud({
    apiKey: KEY,
    base: "https://upstream.test",
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      const which = url.includes("/attestation/report")
        ? replies.report
        : url.includes("/chat/completions")
          ? replies.completion
          : replies.signature;
      if (which !== undefined) return which;
      if (replies.on !== undefined) return replies.on({ url, init });
      throw new Error(`nothing in the harness answers ${url}`);
    },
  });
  return { cloud, sent: calls };
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** `RequestInit["headers"]` is a union of four shapes; this service builds one of them, a plain object. */
const sentHeader = (init: RequestInit, name: string): string | undefined =>
  (init.headers as Record<string, string> | undefined)?.[name];

const REPORT = { gateway_attestation: { signing_address: "0xg" }, model_attestations: [{ signing_address: "0xm" }] };
const NONCE = "ab".repeat(32);

test("the report call is the one ARCHITECTURE §7.1 documents, and it gets no key", async () => {
  const { cloud, sent } = harness({ report: json(REPORT) });
  const report = await cloud.report("fictional-lab/Model-1", NONCE);
  assert.deepEqual(report, REPORT, "the proxy re-shaped somebody else's report");

  const [only] = sent;
  assert.equal(only?.url, `https://upstream.test/v1/attestation/report?model=fictional-lab%2FModel-1&nonce=${NONCE}&signing_algo=ecdsa`);
  assert.equal(sentHeader(only!.init, "x-no-aliasing"), "true");
  assert.equal(sentHeader(only!.init, "authorization"), undefined, "a key was sent to an endpoint measured to be public");
});

test("the default base is the host that was measured, not a guess", async () => {
  const calls: string[] = [];
  const cloud = nearAiCloud({
    apiKey: KEY,
    fetchFn: async (url) => {
      calls.push(url);
      return json(REPORT);
    },
  });
  await cloud.report("m", NONCE);
  assert.ok(calls[0]?.startsWith(CLOUD_API), calls[0]);
});

test("a model id is a parameter, not a URL: it cannot add a query field", async () => {
  const { cloud, sent } = harness({ report: json(REPORT) });
  await cloud.report("x&nonce=0000000000000000000000000000000000000000000000000000000000000000&signing_algo=ed25519", NONCE);
  const url = sent[0]!.url;
  assert.equal(new URL(url).searchParams.get("nonce"), NONCE, `a hostile model id rewrote the nonce: ${url}`);
  assert.equal(new URL(url).searchParams.get("signing_algo"), "ecdsa");
  assert.equal(new URL(url).searchParams.getAll("model").length, 1);
});

test("the completion sends the exact bytes it was handed, with the key as a bearer", async () => {
  const body = JSON.stringify({ model: "m", messages: [{ role: "user", content: "as the only clerk" }] });
  const { cloud, sent } = harness({ completion: json({ id: "chat-1", choices: [] }) });
  const completion = await cloud.complete({ body });

  const [only] = sent;
  assert.equal(only?.init.body, body, "the request was re-serialized, so its hash is not the signed one");
  assert.equal(sentHeader(only!.init, "authorization"), `Bearer ${KEY}`);
  assert.equal(sentHeader(only!.init, "content-type"), "application/json");
  assert.equal(only?.init.method, "POST");
  assert.deepEqual(completion, { chatId: "chat-1", responseText: JSON.stringify({ id: "chat-1", choices: [] }) });
});

test("the signature call carries the chat id as one path segment", async () => {
  const { cloud, sent } = harness({ signature: json({ text: "t" }) });
  await cloud.signature("chat/../../x?y=1");
  assert.equal(sent[0]?.url, "https://upstream.test/v1/signature/chat%2F..%2F..%2Fx%3Fy%3D1?signing_algo=ecdsa");
  assert.equal(sentHeader(sent[0]!.init, "authorization"), `Bearer ${KEY}`);
});

test("a completion that answers with nothing readable is refused, and the body is not quoted", async () => {
  const replies = [
    ["plain prose", new Response("not json at all")],
    ["no id", json({ choices: [] })],
    ["an empty id", json({ id: "" })],
  ] as const;
  for (const [label, reply] of replies) {
    const { cloud } = harness({ completion: reply });
    const error = await cloud.complete({ body: "{}" }).then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof UpstreamError, `a completion with ${label} did not fail`);
    assert.ok(!error.message.includes("only clerk"), error.message);
  }
});

test("a non-2xx from any endpoint names the endpoint and the status, and nothing else", async () => {
  const cases: readonly (readonly [string, (cloud: Cloud) => Promise<unknown>, string])[] = [
    ["report", (cloud) => cloud.report("m", NONCE), "attestation report"],
    ["completion", (cloud) => cloud.complete({ body: "{}" }), "chat completion"],
    ["signature", (cloud) => cloud.signature("chat-1"), "response signature"],
  ];
  for (const [label, call, where] of cases) {
    const { cloud } = harness({
      report: json({ e: 1 }, 500),
      completion: json({ e: 1 }, 503),
      signature: json({ e: 1 }, 429),
    });
    const error = await call(cloud).then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof UpstreamError, `${label} answered 5xx without failing`);
    assert.equal(error.where, where);
    assert.match(error.message, new RegExp(`${where}: HTTP (500|503|429)`), error.message);
  }
});

test("every upstream call is given an abort signal, so a stalled service cannot hold a request open", async () => {
  const { cloud, sent } = harness({ report: json(REPORT), completion: json({ id: "c" }), signature: json({}) });
  await cloud.report("m", NONCE);
  await cloud.complete({ body: "{}" });
  await cloud.signature("c");
  for (const call of sent) {
    assert.ok(call.init.signal instanceof AbortSignal, `${call.url} went without a signal`);
  }
});

test("a timeout is reported as a timeout, with the number the proxy was built with", async () => {
  const { cloud } = harness(
    {
      on: () => {
        const timedOut = new Error("This operation was aborted");
        timedOut.name = "TimeoutError";
        throw timedOut;
      },
    },
    { timeoutMs: 250 },
  );
  const error = await cloud.report("m", NONCE).then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof UpstreamError);
  assert.equal(error.message, "attestation report: no answer within 250ms");
});

test("a transport that throws anything else is still an upstream failure, and the key is not in it", async () => {
  const { cloud } = harness({
    on: () => {
      throw new TypeError(`fetch failed connecting to ${KEY}@upstream.test`);
    },
  });
  const error = await cloud.complete({ body: "{}" }).then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof UpstreamError);
  assert.equal(error.message, "chat completion: could not be reached");
});

test("the completion content is read where §7.2 puts it, and nowhere else", () => {
  assert.equal(
    completionContent(JSON.stringify({ choices: [{ message: { content: '{"suggestions":[]}' } }] })),
    '{"suggestions":[]}',
  );
  for (const body of ["", "not json", "{}", '{"choices":[]}', '{"choices":[{}]}', '{"choices":"nope"}']) {
    assert.equal(completionContent(body), undefined, `content came out of ${body}`);
  }
});
