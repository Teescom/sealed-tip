// S-8.6: the quote proxy, driven against a fake 1Click transport.
//
// What is worth testing here is what a proxy gets wrong quietly: a body it re-shaped on the way out, a
// bearer key sent somewhere it should not be, an answer with no deposit address that gets filled in anyway,
// an upstream error that repeats the caller's request, and a quote that a cache hands to the next tipster.
// The wire shape is not invented either — it is the one the live API accepted on 2026-11-10.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Hono } from "hono";

import { createApp } from "../src/app.js";
import { QUOTE_MAX_BODY_BYTES, ONECLICK_API, QUOTE_TTL_MS, ASSETS, createQuoter } from "../src/quote/oneclick.js";
import { quoteRoutes } from "../src/routes/quote.js";
import { memoryBlobStore } from "../src/store/blob.js";

const KEY = "sk-fictional-not-a-real-key";
const NOW = 1_760_000_000_000;
const REQUEST = {
  originAsset: "USDC.near",
  destinationAsset: "Tron USDT",
  amount: "150000000",
  recipient: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
};

interface Sent {
  url: string;
  init: RequestInit;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const harness = (
  reply: (sent: Sent) => Response,
  options: { timeoutMs?: number } = {},
): { quoter: ReturnType<typeof createQuoter>; sent: Sent[] } => {
  const sent: Sent[] = [];
  const quoter = createQuoter({
    apiKey: KEY,
    refundTo: "sealedtip.testnet",
    base: "https://quote.test",
    now: () => NOW,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    fetchFn: async (url, init) => {
      sent.push({ url, init });
      return reply({ url, init });
    },
  });
  return { quoter, sent };
};

const QUOTE = {
  quote: {
    amountIn: "150000000",
    amountOut: "149687969",
    amountOutFormatted: "149.687969",
    depositAddress: "5d57ab149dfe88d29f3dab3fc06ba6911e8b3a135ce0eeb6ab7b227abbb75f84",
  },
};

const sentBody = (init: RequestInit): Record<string, unknown> =>
  JSON.parse(String(init.body)) as Record<string, unknown>;

const header = (init: RequestInit, name: string): string | undefined =>
  (init.headers as Record<string, string> | undefined)?.[name];

test("the request is the one the live API accepted, field for field", async () => {
  const { quoter, sent } = harness(() => json(QUOTE, 201));
  const outcome = await quoter.quote(REQUEST);
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);

  const [only] = sent;
  assert.equal(only?.url, "https://quote.test/quote");
  assert.equal(only?.init.method, "POST");
  assert.equal(header(only!.init, "authorization"), `Bearer ${KEY}`);
  assert.equal(header(only!.init, "content-type"), "application/json");

  assert.deepEqual(sentBody(only!.init), {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: ASSETS["USDC.near"],
    depositType: "ORIGIN_CHAIN",
    destinationAsset: ASSETS["Tron USDT"],
    amount: "150000000",
    refundTo: "sealedtip.testnet",
    refundType: "INTENTS",
    recipient: REQUEST.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(NOW + QUOTE_TTL_MS).toISOString(),
  });
});

test("the default base and timeout are the measured host and a bound", async () => {
  const calls: Sent[] = [];
  const quoter = createQuoter({
    apiKey: KEY,
    refundTo: "sealedtip.testnet",
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return json(QUOTE, 201);
    },
  });
  await quoter.quote(REQUEST);
  assert.equal(calls[0]?.url, `${ONECLICK_API}/quote`);
  assert.ok(calls[0]?.init.signal instanceof AbortSignal, "a stalled 1Click could hold the request open forever");
});

test("the answer is flattened into the four fields the claim page signs", async () => {
  const { quoter } = harness(() => json(QUOTE, 201));
  const outcome = await quoter.quote(REQUEST);
  assert.deepEqual(outcome, {
    ok: true,
    quote: {
      depositAddress: QUOTE.quote.depositAddress,
      memo: null,
      estimatedAmount: "149.687969",
      destinationAsset: "Tron USDT",
    },
  });
});

test("a quote with no deposit address is refused, never filled in", async () => {
  // This is the exact shape of a `dry: true` answer: amounts, no address.
  const { quoter } = harness(() => json({ quote: { amountOut: "149687969", amountOutFormatted: "149.687969" } }, 201));
  const outcome = await quoter.quote(REQUEST);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? 0 : outcome.status, 502);
  assert.match(outcome.ok ? "" : outcome.error, /without a deposit address/);
  assert.ok(!("depositAddress" in outcome), "an address appeared from nowhere");
});

test("a quote with no amount is refused for the same reason", async () => {
  const { quoter } = harness(() => json({ quote: { depositAddress: "abc" } }, 201));
  const outcome = await quoter.quote(REQUEST);
  assert.equal(outcome.ok ? 0 : outcome.status, 502);
  assert.match(outcome.ok ? "" : outcome.error, /without an amount out/);
});

test("a canonical id passes through, and an unknown label is a 400 before any call", async () => {
  const canonical = "nep141:usdt.tether-token.near";
  const { quoter, sent } = harness(() => json(QUOTE, 201));
  const outcome = await quoter.quote({ ...REQUEST, destinationAsset: canonical });
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
  assert.equal(sentBody(sent[0]!.init).destinationAsset, canonical);

  const unknown = await quoter.quote({ ...REQUEST, destinationAsset: "Dogecoin" });
  assert.equal(unknown.ok ? 0 : unknown.status, 400);
  assert.match(unknown.ok ? "" : unknown.error, /Dogecoin is not an asset this proxy quotes/);
  assert.equal(sent.length, 1, "a refused label still reached the upstream");
});

test("the amount is base units, an integer string, and zero is not a quote", async () => {
  const { quoter, sent } = harness(() => json(QUOTE, 201));
  for (const amount of ["1.5", "150000000n", "0", "-1"]) {
    const outcome = await quoter.quote({ ...REQUEST, amount });
    assert.equal(outcome.ok ? 0 : outcome.status, 400, `${amount} was not refused`);
  }
  assert.equal(sent.length, 0);
});

test("a caller error from 1Click comes back as a 400 with its own sentence", async () => {
  const { quoter } = harness(() => json({ message: "recipient is not valid" }, 400));
  const outcome = await quoter.quote(REQUEST);
  assert.equal(outcome.ok ? 0 : outcome.status, 400);
  assert.equal(outcome.ok ? "" : outcome.error, "1Click answered 400: recipient is not valid");
});

test("an upstream failure is a 502 that names the status and repeats no field of the request", async () => {
  const { quoter } = harness(() =>
    json({ message: "Internal server error", correlationId: "0b7d", path: "/v0/quote" }, 500),
  );
  const outcome = await quoter.quote(REQUEST);
  const error = outcome.ok ? "" : outcome.error;
  assert.equal(outcome.ok ? 0 : outcome.status, 502);
  assert.match(error, /1Click answered 500/);
  for (const value of [REQUEST.recipient, REQUEST.amount, ASSETS["Tron USDT"]!]) {
    assert.ok(!error.includes(value), `the error repeated ${value}`);
  }
});

test("an unreachable 1Click is a 502, and the key is not in the sentence", async () => {
  const quoter = createQuoter({
    apiKey: KEY,
    refundTo: "sealedtip.testnet",
    base: "https://quote.test",
    fetchFn: async () => {
      throw new TypeError(`fetch failed connecting to ${KEY}@quote.test`);
    },
  });
  const outcome = await quoter.quote(REQUEST);
  assert.equal(outcome.ok ? 0 : outcome.status, 502);
  assert.equal(outcome.ok ? "" : outcome.error, "1Click could not be reached");
});

test("a timeout names the number it was built with", async () => {
  const { quoter } = harness(
    () => {
      const timedOut = new Error("This operation was aborted");
      timedOut.name = "TimeoutError";
      throw timedOut;
    },
    { timeoutMs: 250 },
  );
  const outcome = await quoter.quote(REQUEST);
  assert.equal(outcome.ok ? "" : outcome.error, "1Click did not answer within 250ms");
});

test("every asset id in the table is one 1Click's own list returned", () => {
  assert.equal(Object.keys(ASSETS).length, 5);
  for (const [label, id] of Object.entries(ASSETS)) {
    assert.match(id, /^nep141:[A-Za-z0-9._:-]+$/, `${label} is not an id`);
  }
  // The origin is Circle's USDC on NEAR, the contract address 1Click listed on 2026-11-10.
  assert.equal(ASSETS["USDC.near"], "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
  assert.match(ASSETS["Tron USDT"]!, /tron-d28a265909efecdcee7c5028585214ea0b96f015/);
});

test("the route answers 503 while no key is configured, before it reads a body", async () => {
  const app = quoteRoutes({ quoter: null });
  const response = await app.request("/", { method: "POST", body: "{not json" });
  assert.equal(response.status, 503);
  assert.match(((await response.json()) as { error: string }).error, /not configured/);
});

test("the route refuses a body it cannot parse, and one over the cap by size only", async () => {
  const app = quoteRoutes({ quoter: createQuoter({ apiKey: KEY, refundTo: "sealedtip.testnet" }) });
  const notJson = await app.request("/", { method: "POST", body: "{not json" });
  assert.equal(notJson.status, 400);

  const padding = "x".repeat(QUOTE_MAX_BODY_BYTES + 1);
  const over = await app.request("/", { method: "POST", body: padding });
  assert.equal(over.status, 413);
  const body = (await over.json()) as { error: string };
  assert.match(body.error, /body over the cap/);
  assert.ok(!body.error.includes("xxxx"), "the refusal quoted the body");
});

test("a successful quote is returned through the real app and cached by nobody", async () => {
  const quoter = createQuoter({
    apiKey: KEY,
    refundTo: "sealedtip.testnet",
    fetchFn: async () => json(QUOTE, 201),
  });
  const app = createApp({
    blobs: memoryBlobStore(1024),
    relay: new Hono(),
    ai: new Hono(),
    quote: quoteRoutes({ quoter }),
  });
  const response = await app.request("/quote", { method: "POST", body: JSON.stringify(REQUEST) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    depositAddress: QUOTE.quote.depositAddress,
    memo: null,
    estimatedAmount: "149.687969",
    destinationAsset: "Tron USDT",
  });

  const get = await app.request("/quote");
  assert.equal(get.status, 404, "a GET has nothing to answer with");
});

test("a claim's deposit address can be tracked, and the answer names only its state", async () => {
  const sent: Sent[] = [];
  const quoter = createQuoter({
    apiKey: KEY,
    refundTo: "sealedtip.testnet",
    base: "https://quote.test",
    fetchFn: async (url, init) => {
      sent.push({ url, init });
      return json({ status: "SUCCESS", destination: "tron", amountOut: "1019666" });
    },
  });
  const app = createApp({ blobs: memoryBlobStore(1024), relay: new Hono(), ai: new Hono(), quote: quoteRoutes({ quoter }) });
  const address = "5d57ab149dfe88d29f3dab3fc06ba6911e8b3a135ce0eeb6ab7b227abbb75f84";

  const response = await app.request(`/quote/status?depositAddress=${address}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store", "a status that is cached is a status that lies");
  const body = (await response.json()) as { status: string };
  assert.equal(body.status, "SUCCESS");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.url, `https://quote.test/status?depositAddress=${address}`);
});

test("a malformed deposit address is refused before anything upstream is called", async () => {
  const sent: Sent[] = [];
  const quoter = createQuoter({
    apiKey: KEY,
    refundTo: "sealedtip.testnet",
    base: "https://quote.test",
    fetchFn: async (url, init) => {
      sent.push({ url, init });
      return json({ status: "SUCCESS" });
    },
  });
  const app = createApp({ blobs: memoryBlobStore(1024), relay: new Hono(), ai: new Hono(), quote: quoteRoutes({ quoter }) });

  for (const bad of ["", "not-hex", "A".repeat(64), "a".repeat(63)]) {
    const response = await app.request(`/quote/status?depositAddress=${bad}`);
    assert.equal(response.status, 400, `accepted ${JSON.stringify(bad)}`);
    const body = (await response.json()) as { error: string };
    if (bad.length > 0) assert.ok(!body.error.includes(bad), "the refusal repeated the address");
  }
  assert.equal(sent.length, 0, "a caller error must not reach 1Click");
});
