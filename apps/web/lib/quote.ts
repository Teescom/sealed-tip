import type { TipApi } from "./api";

export interface QuoteRequest {
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
}

export interface QuoteResponse {
  depositAddress: string;
  memo: string | null;
  estimatedAmount: string;
  destinationAsset: string;
}

/**
 * The quote endpoint is a stub until S-8.6 lands. A caller must never be handed an invented payout
 * route: an address the tipster signs a claim against is spent on chain, so a fabricated one is worse
 * than no quote at all. Every failure below throws.
 */
export class QuoteUnavailableError extends Error {}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export async function fetchCrossChainQuote(
  api: TipApi,
  apiUrl: string,
  req: QuoteRequest,
): Promise<QuoteResponse> {
  const getQuote = (api as unknown as Record<string, unknown>).getQuote;
  if (typeof getQuote === "function") {
    return (await (getQuote as (req: QuoteRequest) => Promise<QuoteResponse>).call(api, req));
  }

  let res: Response;
  try {
    res = await fetch(`${apiUrl.replace(/\/+$/, "")}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch (err) {
    throw new QuoteUnavailableError(
      `the quote service could not be reached: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).trim();
    throw new QuoteUnavailableError(
      `the quote service answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  const depositAddress = text(data.depositAddress) || text(data.deposit_address);
  const estimated = data.estimatedAmount ?? data.amountOut;
  if (depositAddress.length === 0 || (typeof estimated !== "string" && typeof estimated !== "number")) {
    throw new QuoteUnavailableError("the quote service answered without a deposit address and an amount");
  }

  return {
    depositAddress,
    memo: data.memo ? String(data.memo) : null,
    estimatedAmount: String(estimated),
    destinationAsset: req.destinationAsset,
  };
}
