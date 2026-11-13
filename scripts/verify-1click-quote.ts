// Verify the 1Click quote contract this project depends on, without spending anything (S-0.6).
//
// Usage: pnpm verify:1click
//
// This is the free stand-in for the $1 mainnet deposit check, and it exists because that check cannot be
// moved to testnet: NEAR Intents has no testnet deployment, and 1Click's own quickstart says so in as many
// words — "There is no testnet version of NEAR Intents - use small amounts for test swaps". A quote moves
// no money; only a deposit does. So every check below runs against the production API for nothing.
//
// What it proves is the half the deposit check was really for: that the request shape is accepted, that
// the deposit type we send is the one the contract can pay, and that the answer carries a 64-hex address
// the claim can sign, on the floor the API currently enforces. What it cannot prove is that 1Click credits
// and bridges the deposit — that needs real mainnet funds at the floor this script prints. The product
// does not use this rail on testnet: the demo pays `Payout::Near`.
import { readFileSync } from "node:fs";

import {
  DEPOSIT_TYPE,
  REFUND_TYPE,
  amountOutOf,
  assetIdsIn,
  depositAddressOf,
  isDepositAddress,
  parseFloor,
  quoteRequest,
  refusalMessage,
} from "./lib/oneclick-quote.js";

const API = "https://1click.chaindefuser.com/v0";
const TIMEOUT_MS = 25_000;
const MICRO_USDC = 1_000_000;

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A non-JSON body is kept as text: the message on it is still the diagnosis.
    return text;
  }
};

const post = async (body: unknown): Promise<Answer> => {
  const response = await fetch(`${API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, body: parse(await response.text()) };
};

const listedAssets = async (): Promise<string[]> => {
  const response = await fetch(`${API}/tokens`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GET /tokens answered ${response.status}`);
  const list = await response.json();
  if (!Array.isArray(list)) throw new Error("GET /tokens did not answer a list");
  return list.flatMap((entry: unknown) =>
    typeof entry === "object" && entry !== null && "assetId" in entry && typeof entry.assetId === "string"
      ? [entry.assetId]
      : [],
  );
};

const run = async (): Promise<number> => {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  let live: string[];
  try {
    live = await listedAssets();
  } catch (error) {
    console.error(`could not reach 1Click: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  add("tokens-reachable", live.length > 100, `${live.length} assets listed`);

  // The table the proxy ships is what the claim page offers, so an id that has left the live list is a
  // 400 for every tipster who picks that label. This reads the source rather than importing it, because
  // scripts/ does not depend on apps/api (nor should it).
  const source = readFileSync(new URL("../apps/api/src/quote/oneclick.ts", import.meta.url), "utf8");
  const shipped = assetIdsIn(source);
  const missing = shipped.filter((id) => !live.includes(id));
  add(
    "proxy-assets-are-listed",
    shipped.length > 0 && missing.length === 0,
    missing.length === 0
      ? `${shipped.length} ids quoted in apps/api/src/quote/oneclick.ts all resolve`
      : `not in GET /v0/tokens: ${missing.join(", ")}`,
  );

  // Ask below the floor first: the refusal is where the API states its own minimum, so this reports the
  // number in force today instead of a constant that silently rots.
  const probe = await post(quoteRequest(String(MICRO_USDC)));
  const floor = parseFloor(refusalMessage(probe.body));
  const refused = probe.status >= 400 && probe.status < 500;
  add(
    "floor-is-stated",
    refused ? floor !== undefined : probe.status === 201,
    refused
      ? `1.00 USDC refused: "${refusalMessage(probe.body).slice(0, 140)}"`
      : `1.00 USDC already accepted (HTTP ${probe.status}); no floor to report`,
  );

  const amount = (floor ?? BigInt(MICRO_USDC)).toString();
  const quote = await post(quoteRequest(amount));
  const address = depositAddressOf(quote.body);
  const amountOut = amountOutOf(quote.body);
  const quoted = quote.status === 201 && isDepositAddress(address) && amountOut !== undefined;
  add(
    "quote-at-floor-carries-a-deposit-address",
    quoted,
    quote.status !== 201
      ? `HTTP ${quote.status}: ${refusalMessage(quote.body).slice(0, 140)}`
      : isDepositAddress(address)
        ? `${address.slice(0, 12)}… out ${String(amountOut)} base units (depositType ${DEPOSIT_TYPE}, refundType ${REFUND_TYPE})`
        : `no 64-hex depositAddress: ${JSON.stringify(quote.body).slice(0, 140)}`,
  );

  // `refundType: ORIGIN_CHAIN` is the field that breaks, not `depositType`. Pinned so nobody reads a 500
  // as "ORIGIN_CHAIN deposit is unsupported" and switches to INTENTS, which the contract cannot pay.
  const trap = await post(quoteRequest(amount, DEPOSIT_TYPE, "ORIGIN_CHAIN"));
  add(
    "refundType-ORIGIN_CHAIN-is-still-refused",
    trap.status >= 400,
    `HTTP ${trap.status}${refusalMessage(trap.body) === "" ? "" : `: ${refusalMessage(trap.body).slice(0, 80)}`}`,
  );

  for (const check of checks) console.log(`${check.ok ? "✔" : "✘"} ${check.name} — ${check.detail}`);
  const failed = checks.filter((check) => !check.ok).length;

  if (floor !== undefined) {
    console.log(`\n1Click's floor right now: ${floor.toString()} base units (${Number(floor) / MICRO_USDC} USDC).`);
  }
  console.log(
    "No funds moved: a quote returns an address, only a deposit spends one.\n\n" +
      "Not covered here, and it needs mainnet money (~the floor above in USDC):\n" +
      "  · 1Click crediting the deposit and bridging to the destination chain — there is no testnet\n" +
      "    version of NEAR Intents, so this cannot be rehearsed on testnet funds\n" +
      "  · whether the contract's memo prefix survives an intents deposit\n" +
      "The testnet product is unaffected: it pays `Payout::Near`, not this rail.\n",
  );
  console.log(failed === 0 ? "quote contract verified." : `FAILED: ${failed} checks.`);
  return failed === 0 ? 0 : 1;
};

process.exitCode = await run();
