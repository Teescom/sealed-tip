// S-6.2: the view client. Two layers get tested, because the bug classes are different.
//
// The first is ours: method names, argument keys, paging defaults, null-vs-missing, and what a refusal
// says. Those run against an injected transport, so they are exact and offline. The second is the
// transport itself — near-api-js 7.4.0's `callFunction` over JSON-RPC — and it runs against a local
// `node:http` server that speaks the `query` endpoint. That half is what proves the bytes on the wire are
// the bytes `contracts/sealedtip/tests` sends, which is the whole claim of this module.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DEFAULT_PAGE, MAX_PAGE, createViewClient, type ViewCall } from "../src/index.js";

const views = JSON.parse(
  readFileSync(new URL("../../../fixtures/views.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const programme = views["get_programme"] as Record<string, unknown>;
const stats = views["get_programme_stats"] as Record<string, unknown>;
const tipPublic = views["get_tip_public"] as Record<string, unknown>;
const tipPanel = views["get_tip_for_panel"] as Record<string, unknown>;
const keeperInfo = views["get_keeper_info"] as Record<string, unknown>;

interface Call {
  readonly method: string;
  readonly args: Record<string, unknown>;
}

/** A transport that answers every view with `payload` and records what it was asked for. */
const recorder = (payload: unknown): { view: ViewCall; calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    view: async (method, args) => {
      calls.push({ method, args });
      return payload;
    },
  };
};

const clientOver = (view: ViewCall) =>
  createViewClient("http://127.0.0.1:1", "sealedtip.st-hack-f8d075.testnet", { view });

test("each method calls the view the contract exports with the argument it declares", async () => {
  const cases: readonly {
    readonly name: string;
    readonly payload: unknown;
    readonly call: (client: ReturnType<typeof clientOver>) => Promise<unknown>;
    readonly want: Call;
  }[] = [
    {
      name: "getProgramme",
      payload: programme,
      call: (c) => c.getProgramme(7),
      want: { method: "get_programme", args: { programme_id: 7 } },
    },
    {
      name: "listProgrammes",
      payload: [programme],
      call: (c) => c.listProgrammes(4, 12),
      want: { method: "list_programmes", args: { from_index: 4, limit: 12 } },
    },
    {
      name: "getProgrammeStats",
      payload: stats,
      call: (c) => c.getProgrammeStats(7),
      want: { method: "get_programme_stats", args: { programme_id: 7 } },
    },
    {
      name: "getTipPublic",
      payload: tipPublic,
      call: (c) => c.getTipPublic(3),
      want: { method: "get_tip_public", args: { tip_id: 3 } },
    },
    {
      name: "getTipForPanel",
      payload: tipPanel,
      call: (c) => c.getTipForPanel(3),
      want: { method: "get_tip_for_panel", args: { tip_id: 3 } },
    },
    {
      name: "getKeeperInfo",
      payload: keeperInfo,
      call: (c) => c.getKeeperInfo(),
      want: { method: "get_keeper_info", args: {} },
    },
  ];
  for (const { name, payload, call, want } of cases) {
    const { view, calls } = recorder(payload);
    await call(clientOver(view));
    assert.deepEqual(calls, [want], `${name} sent the wrong request`);
  }
});

test("the value handed back is the parsed programme, with the contract's units intact", async () => {
  const got = await clientOver(recorder(programme).view).getProgramme(0);
  assert.equal(got?.title, "Public interest fund");
  assert.equal(got?.panel.length, 3);
  assert.deepEqual(got?.scope_hash, new Array(32).fill(51), "the [u8; 32] stays an array of bytes");
  assert.equal(got?.created_at, "1794144144214819000", "a U64 nanosecond stamp stays exact");
  assert.equal(got?.ops_balance, "1000000000000000000000000");

  const panel = await clientOver(recorder(tipPanel).view).getTipForPanel(0);
  assert.equal(panel?.evidence_cid, "0a1b2c-17");
  assert.equal(panel?.switch?.interval, "86400000000000");
  assert.deepEqual(panel?.released_keys?.map((key) => key.member), [
    "member1.test.near",
    "member3.test.near",
  ]);

  const publicView = await clientOver(recorder(tipPublic).view).getTipPublic(0);
  assert.equal(publicView?.status, "Submitted");
  assert.ok(!("evidence_cid" in (publicView ?? {})), "the public projection carries no pointer");
});

/** Two ways a chain read comes back empty and the UI has to treat as one answer: `Option::None`
 * serializes to `null`, while near-api-js returns `undefined` when the node hands it zero result bytes. */
test("absence is null whether the node answered null or answered nothing", async () => {
  for (const empty of [null, undefined]) {
    const client = clientOver(recorder(empty).view);
    assert.equal(await client.getProgramme(9), null, `getProgramme with ${String(empty)}`);
    assert.equal(await client.getTipPublic(9), null, `getTipPublic with ${String(empty)}`);
    assert.equal(await client.getTipForPanel(9), null, `getTipForPanel with ${String(empty)}`);
  }
});

/** `views.rs` answers a limit above 200 by clamping it and saying nothing, and no arguments with 0/50. A
 * page that assumed otherwise would stop at a short page it read as the end of the table. */
test("paging matches the contract: 0/50 by default and 200 at most", async () => {
  const { view, calls } = recorder([]);
  const client = clientOver(view);
  await client.listProgrammes();
  await client.listProgrammes(250);
  await client.listProgrammes(0, 5000);
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      { from_index: 0, limit: DEFAULT_PAGE },
      { from_index: 250, limit: DEFAULT_PAGE },
      { from_index: 0, limit: MAX_PAGE },
    ],
  );
  assert.equal(MAX_PAGE, 200, "views.rs MAX_PAGE");
  assert.equal(DEFAULT_PAGE, 50, "views.rs DEFAULT_PAGE");
});

test("an id the contract could not hold is refused locally, without a call", async () => {
  const bad: readonly number[] = [-1, 1.5, -0.5, Number.NaN, 2 ** 53];
  const calls: readonly (keyof ReturnType<typeof clientOver>)[] = [
    "getProgramme",
    "getProgrammeStats",
    "getTipPublic",
    "getTipForPanel",
  ];
  for (const name of calls) {
    for (const value of bad) {
      const { view, calls: sent } = recorder(programme);
      const method = clientOver(view)[name] as (id: number) => Promise<unknown>;
      await assert.rejects(() => method(value), RangeError, `${name}(${String(value)})`);
      assert.equal(sent.length, 0, `${name} reached the network with an id the contract rejects`);
    }
  }
  const { view, calls: sent } = recorder([]);
  const client = clientOver(view);
  await assert.rejects(() => client.listProgrammes(0, -1), RangeError);
  await assert.rejects(() => client.listProgrammes(1.25), RangeError);
  assert.equal(sent.length, 0);
});

/** Chain values are shaped by whoever submitted the tip, and a thrown message is what ends up in a log. A
 * refusal therefore names the method and the field and repeats nothing it was given. */
test("a schema refusal names the field but never repeats the value", async () => {
  const SENTINEL = "hostile-value-do-not-log";
  const cases: readonly [{ readonly field: string; readonly value: unknown }, RegExp][] = [
    // invalid_type: zod's own message is "expected number, received string", not the string.
    [{ field: "pow_bits", value: SENTINEL }, /pow_bits/],
    // invalid_string: a regex message is the rule we wrote, "decimal string".
    [{ field: "max_reward", value: `${SENTINEL}000` }, /max_reward: decimal string/],
  ];
  for (const [{ field, value }, pattern] of cases) {
    const client = clientOver(recorder({ ...programme, [field]: value }).view);
    const error = await client.getProgramme(0).then(
      () => assert.fail(`${field}=${String(value)} parsed as a programme`),
      (thrown: unknown) => thrown as Error,
    );
    assert.match(error.message, /^get_programme: /);
    assert.match(error.message, pattern);
    assert.ok(!error.message.includes(SENTINEL), `the refusal echoed the value: ${error.message}`);
  }
});

test("a failing view keeps the node's reason and the original error as the cause", async () => {
  const original = new Error(
    "wasm execution failed with error: FunctionCallError(HostError) E01_PROGRAMME_NOT_FOUND",
  );
  const client = clientOver(async () => {
    throw original;
  });
  const error = await client.getProgrammeStats(42).then(
    () => assert.fail("a panicking view resolved"),
    (thrown: unknown) => thrown as Error,
  );
  // The text an operator needs is the contract's own, kept verbatim rather than re-derived by pattern.
  assert.match(error.message, /^get_programme_stats: /);
  assert.ok(error.message.includes("E01_PROGRAMME_NOT_FOUND"));
  assert.equal(error.cause, original);
});

interface RpcRequest {
  readonly url: string;
  readonly body: { jsonrpc: string; method: string; params: Record<string, unknown> };
}

const resultBytes = (payload: unknown): Record<string, unknown> => ({
  block_height: 1_000,
  block_hash: "B".repeat(64),
  result: Array.from(new TextEncoder().encode(JSON.stringify(payload))),
});

/** A stand-in for a neard `query` endpoint: records what arrived and answers the way a node does. */
const rpcStub = async (
  t: { after(fn: () => Promise<void>): void },
  reply: (request: RpcRequest) => unknown,
): Promise<{ url: string; requests: RpcRequest[] }> => {
  const requests: RpcRequest[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const request: RpcRequest = { url: req.url ?? "", body: JSON.parse(raw) as RpcRequest["body"] };
      requests.push(request);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: "1", result: reply(request) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/near-rpc`, requests };
};

test("the default transport sends the request the Rust sandbox suite sends", async (t) => {
  const { url, requests } = await rpcStub(t, () => resultBytes(programme));
  const client = createViewClient(url, "sealedtip.st-hack-f8d075.testnet");
  const got = await client.getProgramme(7);
  assert.equal(got?.id, 0, "the bytes the node held decoded into the programme");

  assert.equal(requests.length, 1);
  const request = requests[0];
  if (!request) assert.fail("the stub saw no request");
  // The path in the configured URL is the RPC path, not a bare origin.
  assert.equal(request.url, "/near-rpc");
  assert.equal(request.body.jsonrpc, "2.0");
  assert.equal(request.body.method, "query");
  assert.deepEqual(request.body.params, {
    request_type: "call_function",
    account_id: "sealedtip.st-hack-f8d075.testnet",
    method_name: "get_programme",
    // Byte-identical to `args_json!({"programme_id": 7})` in the contract tests, which is what makes the
    // captured fixture and this client the same call.
    args_base64: Buffer.from(JSON.stringify({ programme_id: 7 })).toString("base64"),
    finality: "final",
  });
});

test("zero result bytes from the node read as an absent programme", async (t) => {
  const { url, requests } = await rpcStub(t, () => ({
    block_height: 1_000,
    block_hash: "B".repeat(64),
    result: [],
  }));
  assert.equal(await createViewClient(url, "sealedtip.testnet").getProgramme(9), null);
  assert.equal(requests.length, 1);
});

test("a client with no injected transport reads through the endpoint at its configured finality", async (t) => {
  const { url, requests } = await rpcStub(t, (request) =>
    request.body.params["method_name"] === "list_programmes"
      ? resultBytes([programme, programme])
      : resultBytes(stats),
  );
  const client = createViewClient(url, "sealedtip.testnet", { finality: "near-final" });
  const page = await client.listProgrammes(0, 2);
  assert.equal(page.length, 2);
  assert.equal((await client.getProgrammeStats(0)).submitted, 1);
  assert.deepEqual(
    requests.map((r) => [r.body.params["method_name"], r.body.params["finality"]]),
    [
      ["list_programmes", "near-final"],
      ["get_programme_stats", "near-final"],
    ],
  );
});
