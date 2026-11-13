// The pure half of `verify-1click-quote.ts` (S-0.6): the request this project sends to 1Click, and the
// rules its answer has to satisfy. Kept out of the CLI so every rule can be tested without a network.

/**
 * The origin the check quotes. `USDC.near` is Circle's native USDC, which is what a mainnet programme
 * would hold — the testnet programme holds tUSDC and pays `Payout::Near`, never this rail.
 */
export const ORIGIN_ASSET_ID = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** The cheapest bridge destination measured, so the floor this script reports is the floor in use. */
export const DESTINATION_ASSET_ID = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";

/** A Tron address in the shape 1Click validates. A quote moves no money, so it need not belong to anyone. */
export const EXAMPLE_RECIPIENT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";

/** Where a refund goes when a swap never fills. `INTENTS` is the only refund type the live API accepts. */
export const REFUND_TO = "sealedtip.st-deployer-f8d075.testnet";

/**
 * The deposit type the contract can actually pay. `claim_paid_promise` transfers the token to
 * `quote.depositAddress` on NEAR, which is what `ORIGIN_CHAIN` means. `INTENTS` means the opposite — the
 * docs say to skip the on-chain transfer and sign an intent instead — so a transfer against an `INTENTS`
 * quote is paid and never credited. The proxy in `apps/api` sends this same value.
 */
export const DEPOSIT_TYPE = "ORIGIN_CHAIN";

/** `refundType: "ORIGIN_CHAIN"` is the pairing that answers 500, whatever `depositType` says. */
export const REFUND_TYPE = "INTENTS";

/** How long a quote is asked to live. The claim page signs the address inside it, so it must not expire fast. */
export const QUOTE_TTL_MS = 10 * 60 * 1000;

/** The body `POST /v0/quote` requires, in the shape the live API accepted on 2026-11-13. */
export const quoteRequest = (
  amount: string,
  depositType: string = DEPOSIT_TYPE,
  refundType: string = REFUND_TYPE,
  now: number = Date.now(),
): Record<string, unknown> => ({
  dry: false,
  swapType: "EXACT_INPUT",
  slippageTolerance: 100,
  originAsset: ORIGIN_ASSET_ID,
  depositType,
  destinationAsset: DESTINATION_ASSET_ID,
  amount,
  refundTo: REFUND_TO,
  refundType,
  recipient: EXAMPLE_RECIPIENT,
  recipientType: "DESTINATION_CHAIN",
  deadline: new Date(now + QUOTE_TTL_MS).toISOString(),
});

/**
 * The floor the API states when an amount is too small: "Amount is too low for bridge, try at least
 * 1870864". Returned in base units, or `undefined` when the refusal says something else.
 */
export const parseFloor = (message: string): bigint | undefined => {
  const stated = /try at least (\d+)/i.exec(message);
  const digits = stated?.[1];
  return digits === undefined ? undefined : BigInt(digits);
};

/**
 * A deposit address is a 64-hex implicit account, and that shape is what the claim signs. Anything else —
 * a dry quote's empty answer, a memo, an account name — is refused rather than filled in.
 */
export const isDepositAddress = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

/** Every asset id quoted in the proxy's source, so the table it ships can be checked against the live list. */
export const assetIdsIn = (source: string): string[] =>
  [...source.matchAll(/"((?:nep141|nep245):[^"]+)"/g)].flatMap((match) => match[1] ?? []);

/** The `message` of a 1Click refusal, which is where the floor and the field complaints live. */
export const refusalMessage = (body: unknown): string =>
  typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
    ? body.message
    : "";

/** `quote.depositAddress`, or a top-level `depositAddress`: the two places the live API has put it. */
export const depositAddressOf = (body: unknown): unknown => {
  if (typeof body !== "object" || body === null) return undefined;
  const quote = "quote" in body ? body.quote : undefined;
  if (typeof quote === "object" && quote !== null && "depositAddress" in quote) return quote.depositAddress;
  return "depositAddress" in body ? body.depositAddress : undefined;
};

/** `quote.amountOut`, in base units of the destination asset. */
export const amountOutOf = (body: unknown): unknown => {
  if (typeof body !== "object" || body === null) return undefined;
  const quote = "quote" in body ? body.quote : undefined;
  if (typeof quote !== "object" || quote === null) return undefined;
  return "amountOut" in quote ? quote.amountOut : undefined;
};
