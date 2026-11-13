// The 1Click quote call behind `POST /quote` (S-8.6), and nothing else.
//
// Everything in this file that names a field or an asset id was measured against
// https://1click.chaindefuser.com on 2026-11-10, with no funds and no address belonging to anybody:
//   · `POST /v0/quote` requires `dry`, `swapType`, `slippageTolerance`, `originAsset`, `depositType`,
//     `destinationAsset`, `amount`, `refundTo`, `refundType`, `recipient`, `recipientType` and `deadline`.
//     Posting an empty object answers 400 with that list, which is how the set was learned rather than
//     copied from a blog.
//   · `depositType` decides how the money moves, and it has to be the way the contract actually pays.
//     `ORIGIN_CHAIN` is paid by transferring the token to `quote.depositAddress` on NEAR, which is exactly
//     what `claim_paid_promise` in `contracts/sealedtip/src/token.rs` does. `INTENTS` is the opposite: the
//     docs say to skip the on-chain transfer and sign an intent instead, so a transfer against an
//     `INTENTS` quote is paid and never credited. This proxy sends `ORIGIN_CHAIN`.
//   · the field that fails is `refundType: "ORIGIN_CHAIN"` (500), not `depositType`. Measured 2026-11-13
//     one field at a time: ORIGIN_CHAIN+INTENTS answers 201, INTENTS+INTENTS answers 201, and either
//     request with `refundType: ORIGIN_CHAIN` answers 500 `{"message":"Internal server error"}`. The
//     earlier note here changed both fields at once and read the difference as a verdict on
//     `depositType` — which would have sent an on-chain transfer against a quote that cannot accept one.
//   · the numbers live under `quote`: `amountOut` in base units and `amountOutFormatted`. A quote with
//     `dry: false` also carries `quote.depositAddress` — a 64-hex intents account, with no memo — and a
//     `dry: true` quote carries no deposit address at all. This proxy always asks for a real quote
//     because the claim signs that address; a quote moves no money, only the deposit does.
//   · `amount` must be base units as an integer string, and the claim page's reward is the same u128 the
//     contract holds, so it passes through untouched.
//
// The asset ids are not guesses either: `GET /v0/tokens` returned them (216 assets at the time). Only the
// origin and the four destinations this product offers are listed; anything else has to arrive as an id,
// so a typo is a 400 here instead of a quote for a token nobody meant.

import { z } from "zod";

import { asString, field, readJson } from "../json.js";

export const ONECLICK_API = "https://1click.chaindefuser.com/v0";

/** A stalled quote must not hold a request open; the claim page cannot tell that from a dead API. */
export const ONECLICK_TIMEOUT_MS = 15_000;

/** How long the tipster has to sign a claim against this quote before 1Click stops honouring it. */
export const QUOTE_TTL_MS = 10 * 60 * 1000;

/** Basis points. 1 % is the tolerance the demo uses; the API accepts 0–10000. */
export const DEFAULT_SLIPPAGE_BPS = 100;

/** A quote body is four short strings; a megabyte of JSON is not a quote request. */
export const QUOTE_MAX_BODY_BYTES = 4_096;

/**
 * `GET /v0/tokens`, 2026-11-10. The keys are the labels the claim page shows; the values are 1Click's
 * asset ids. `USDC.near` is Circle's native USDC on NEAR, which is what a mainnet programme would hold.
 */
export const ASSETS: Readonly<Record<string, string>> = {
  "USDC.near": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "Tron USDT": "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
  "Ethereum USDC": "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
  "Arbitrum USDC": "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  "Solana USDC": "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
};

const RAW_ID = /^(nep141|nep245):[A-Za-z0-9._:-]+$/;

/** A label from the table, or an id already in 1Click's own form. `undefined` is a caller error. */
export const assetId = (value: string): string | undefined =>
  ASSETS[value] ?? (RAW_ID.test(value) ? value : undefined);

const Amount = z.string().max(40, "amount is a u128 in base units").superRefine((value, at) => {
  // The pattern first: `BigInt("1.5")` throws, and a schema that throws is a 500 instead of a 400.
  if (!/^\d+$/.test(value)) {
    at.addIssue({ code: "custom", message: "amount is base units: an integer string" });
  } else if (BigInt(value) === 0n) {
    at.addIssue({ code: "custom", message: "amount must be greater than zero" });
  }
});

const QuoteBody = z.object({
  originAsset: z.string().min(1).max(128),
  destinationAsset: z.string().min(1).max(128),
  amount: Amount,
  recipient: z.string().min(1).max(256),
  /** Where a failed swap returns the money. The contract that paid it out, unless the caller says otherwise. */
  refundTo: z.string().min(1).max(64).optional(),
  slippageTolerance: z.number().int().min(0).max(10_000).optional(),
});

export interface QuoteResult {
  readonly depositAddress: string;
  readonly memo: string | null;
  readonly estimatedAmount: string;
  /** The caller's own label, echoed for display. This module never invents a rate or a destination. */
  readonly destinationAsset: string;
}

export type QuoteOutcome =
  | { ok: true; quote: QuoteResult }
  | { ok: false; status: 400 | 429 | 502; error: string };

export interface OneClickOptions {
  /** Sent as a bearer. The live API answered without one when measured; the gate is the owner's decision. */
  readonly apiKey: string;
  /** The account a failed swap refunds to — the contract that paid the reward out. */
  readonly refundTo: string;
  readonly base?: string;
  readonly timeoutMs?: number;
  /** The seam `quote.test.ts` uses: a call this file makes cannot otherwise be tested without a network. */
  readonly fetchFn?: (input: string, init: RequestInit) => Promise<Response>;
  readonly now?: () => number;
}

export interface Quoter {
  quote(body: unknown): Promise<QuoteOutcome>;
  /**
   * `GET /v0/status` for a deposit the claim already signed. Without it a tipster can choose a cross-chain
   * payout and then have no way to see whether it landed — the claim page is the only surface they have.
   */
  status(depositAddress: string): Promise<StatusOutcome>;
}

export type StatusOutcome =
  | { readonly ok: true; readonly state: string; readonly detail: Record<string, unknown> }
  | { readonly ok: false; readonly status: 400 | 502; readonly error: string };

const describe = (issues: readonly z.ZodIssue[]): string =>
  issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");

const bad = (status: 400 | 429 | 502, error: string): QuoteOutcome => ({ ok: false, status, error });

/**
 * A 400 from 1Click is about the caller's request (an address of the wrong shape, an amount under the
 * swap minimum) and goes back as a 400 so the page can say why; a 429 keeps its meaning; anything else is
 * upstream's fault and becomes a 502.
 */
const refusal = (status: number): 400 | 429 | 502 => (status === 400 ? 400 : status === 429 ? 429 : 502);

export const createQuoter = (options: OneClickOptions): Quoter => {
  const base = options.base ?? ONECLICK_API;
  const timeoutMs = options.timeoutMs ?? ONECLICK_TIMEOUT_MS;
  const send = options.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
  const now = options.now ?? Date.now;

  return {
    quote: async (body: unknown): Promise<QuoteOutcome> => {
      const parsed = QuoteBody.safeParse(body);
      if (!parsed.success) return bad(400, `quote request: ${describe(parsed.error.issues)}`);

      const originAsset = assetId(parsed.data.originAsset);
      if (originAsset === undefined) {
        return bad(400, `originAsset: ${parsed.data.originAsset} is not an asset this proxy quotes`);
      }
      const destinationAsset = assetId(parsed.data.destinationAsset);
      if (destinationAsset === undefined) {
        return bad(400, `destinationAsset: ${parsed.data.destinationAsset} is not an asset this proxy quotes`);
      }

      const request = {
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: parsed.data.slippageTolerance ?? DEFAULT_SLIPPAGE_BPS,
        originAsset,
        depositType: "ORIGIN_CHAIN",
        destinationAsset,
        amount: parsed.data.amount,
        refundTo: parsed.data.refundTo ?? options.refundTo,
        refundType: "INTENTS",
        recipient: parsed.data.recipient,
        recipientType: "DESTINATION_CHAIN",
        deadline: new Date(now() + QUOTE_TTL_MS).toISOString(),
      };

      let response: Response;
      try {
        response = await send(`${base}/quote`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // The cause is never in the message: a fetch failure can carry the URL, and the request behind it
        // carries the tipster's payout address.
        const timeout = error instanceof Error && error.name === "TimeoutError";
        return bad(502, timeout ? `1Click did not answer within ${timeoutMs}ms` : "1Click could not be reached");
      }

      const text = await response.text();
      if (!response.ok) {
        const stated = asString(field(readJson(text), "message"));
        const detail = stated === undefined ? "" : `: ${stated.slice(0, 200)}`;
        return bad(refusal(response.status), `1Click answered ${response.status}${detail}`);
      }

      const data = readJson(text);
      const quote = field(data, "quote");
      const depositAddress = asString(field(quote, "depositAddress")) ?? asString(field(data, "depositAddress"));
      const amountOut = asString(field(quote, "amountOutFormatted")) ?? asString(field(quote, "amountOut"));
      const memo = asString(field(quote, "memo")) ?? asString(field(data, "memo"));

      if (depositAddress === undefined || depositAddress.length === 0) {
        // A dry quote looks exactly like this. An address the tipster signs a claim against is spent on
        // chain, so an answer without one is refused rather than filled in.
        return bad(502, "1Click answered without a deposit address");
      }
      if (amountOut === undefined || amountOut.length === 0) {
        return bad(502, "1Click answered without an amount out");
      }

      return {
        ok: true,
        quote: {
          depositAddress,
          memo: memo ?? null,
          estimatedAmount: amountOut,
          destinationAsset: parsed.data.destinationAsset,
        },
      };
    },

    status: async (depositAddress: string): Promise<StatusOutcome> => {
      // Checked before the call, not after: the address is the only thing this route carries, and a
      // malformed one is a caller error that should cost nothing and name no upstream.
      if (!/^[0-9a-f]{64}$/.test(depositAddress)) {
        return { ok: false, status: 400, error: "depositAddress must be 64 lowercase hex characters" };
      }
      let response: Response;
      try {
        response = await send(`${base}/status?depositAddress=${depositAddress}`, {
          method: "GET",
          headers: { authorization: `Bearer ${options.apiKey}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timeout = error instanceof Error && error.name === "TimeoutError";
        return { ok: false, status: 502, error: timeout ? `1Click did not answer within ${timeoutMs}ms` : "1Click could not be reached" };
      }
      const text = await response.text();
      if (!response.ok) {
        // The status and the upstream message only; never the address we asked about.
        const stated = asString(field(readJson(text), "message"));
        const detail = stated === undefined ? "" : `: ${stated.slice(0, 200)}`;
        return { ok: false, status: 502, error: `1Click answered ${response.status}${detail}` };
      }
      const data = readJson(text);
      const state = asString(field(data, "status")) ?? "UNKNOWN";
      // A status body is an object; anything else (an HTML error page, a bare string) is reported as an
      // unknown state rather than pretending to have parsed one.
      const detail =
        typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
      return { ok: true, state, detail };
    },
  };
};
