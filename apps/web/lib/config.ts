// The deployment coordinates a tipster's page is built against (S-10.1, S-10.3).
//
// Every value here is public by design: a tipster's anonymity does not depend on hiding the contract id or
// the RPC endpoint, and a page that refused to say which chain it was talking to would be a page nobody can
// audit. What is *not* here is anything that could identify a tipster or spend anything — no keys, no
// relayer credentials, no `NEAR_AI_API_KEY`. `apps/web` cannot hold those even by accident, because nothing
// in this file reads a variable without the `NEXT_PUBLIC_` prefix, and Next replaces only those at build time.
//
// The check is a list of problems rather than a throw for one reason: a misconfigured deployment is opened
// by a judge, and "these four things are wrong, here is the file that fixes them" is the difference between
// a page that can be repaired and a white screen with a stack trace.
import { z } from "zod";

const Network = z.union([z.literal("testnet"), z.literal("mainnet"), z.literal("betanet")]);

/** An account id as the chain accepts it, which is not quite what `AccountId` in `@sealedtip/core` allows. */
const ContractAccount = z.string().regex(/^[a-z0-9_-]{2,64}(\.[a-z0-9_-]{2,64})*$/, "a NEAR account id");

/**
 * `http(s)` with no path. A base that carries one has been copied from a log line.
 *
 * A trailing slash is accepted here and removed by the transform below, because `…:8787/` is the single
 * most likely thing someone types into `.env`, and the page cannot tell the difference.
 */
const HttpOrigin = z
  .string()
  .regex(/^https?:\/\/[^/\s]+\/?$/, "an http(s) origin with no path")
  .transform((value) => value.replace(/\/+$/, ""));

const PublicEnv = z.object({
  NEXT_PUBLIC_NEAR_NETWORK: Network.default("testnet"),
  NEXT_PUBLIC_NEAR_RPC_URL: HttpOrigin.default("https://rpc.testnet.near.org"),
  NEXT_PUBLIC_SEALEDTIP_CONTRACT: ContractAccount,
  NEXT_PUBLIC_API_URL: HttpOrigin.default("http://localhost:8787"),
  /** The token a funder page deposits into. Optional: the submit flow never needs it, because the panel's
   * rewards are already locked by the time a tipster arrives. */
  NEXT_PUBLIC_TOKEN_CONTRACT: ContractAccount.optional(),
});

export interface PublicConfig {
  readonly network: "testnet" | "mainnet" | "betanet";
  readonly rpcUrl: string;
  readonly contractId: string;
  readonly apiUrl: string;
  readonly tokenContract: string | null;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: PublicConfig }
  | { readonly ok: false; readonly problems: readonly string[] };

const isBlank = (value: string | undefined): boolean => value === undefined || value.trim() === "";

/**
 * The markers that mean "not deployed yet", whatever the schema makes of them.
 *
 * `sealedtip.example.testnet` is a perfectly legal account id, so the only thing between a judge and an
 * RPC error that looks like an outage is this list.
 */
const PLACEHOLDERS = ["<you>", "example", "changeme"];

export const readPublicConfig = (env: Record<string, string | undefined>): ConfigResult => {
  // Before the schema, because the value that ships in `.env.example` — `sealedtip.<you>.testnet` — is not
  // a legal account id, and "NEXT_PUBLIC_SEALEDTIP_CONTRACT: a NEAR account id" is not a sentence that
  // tells anyone to open `.env` and put their contract there.
  const written = env.NEXT_PUBLIC_SEALEDTIP_CONTRACT;
  if (!isBlank(written)) {
    const placeholder = PLACEHOLDERS.find((marker) => (written as string).toLowerCase().includes(marker));
    if (placeholder !== undefined) {
      return {
        ok: false,
        problems: [
          `NEXT_PUBLIC_SEALEDTIP_CONTRACT is still the placeholder "${written}" — set it to the deployed contract account (see .env.example)`,
        ],
      };
    }
  }

  const present: Record<string, string> = {};
  for (const key of Object.keys(PublicEnv.shape)) {
    const value = env[key];
    if (!isBlank(value)) present[key] = value as string;
  }

  const parsed = PublicEnv.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    if (isBlank(env.NEXT_PUBLIC_SEALEDTIP_CONTRACT)) {
      // The one mistake worth naming rather than reporting as a schema path, because it is the mistake
      // everyone makes on a first deployment: an empty `.env` says "no contract", and zod says "required".
      problems.push("NEXT_PUBLIC_SEALEDTIP_CONTRACT is not set — the page has no contract to read (see .env.example)");
    }
    return { ok: false, problems };
  }

  return {
    ok: true,
    config: {
      network: parsed.data.NEXT_PUBLIC_NEAR_NETWORK,
      rpcUrl: parsed.data.NEXT_PUBLIC_NEAR_RPC_URL,
      contractId: parsed.data.NEXT_PUBLIC_SEALEDTIP_CONTRACT,
      apiUrl: parsed.data.NEXT_PUBLIC_API_URL,
      tokenContract: parsed.data.NEXT_PUBLIC_TOKEN_CONTRACT ?? null,
    },
  };
};

/** What the page reads. Built once per process from the variables Next inlined at build time. */
export const publicConfig = (): ConfigResult =>
  readPublicConfig({
    NEXT_PUBLIC_NEAR_NETWORK: process.env.NEXT_PUBLIC_NEAR_NETWORK,
    NEXT_PUBLIC_NEAR_RPC_URL: process.env.NEXT_PUBLIC_NEAR_RPC_URL,
    NEXT_PUBLIC_SEALEDTIP_CONTRACT: process.env.NEXT_PUBLIC_SEALEDTIP_CONTRACT,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_TOKEN_CONTRACT: process.env.NEXT_PUBLIC_TOKEN_CONTRACT,
  });

const SECONDS_PER_DAY = 86_400;
const NS_PER_SECOND = 1_000_000_000n;

/**
 * A number of days as the contract's `SwitchInput.interval`: nanoseconds, as a decimal string.
 *
 * A string because `U64` in `@sealedtip/core` is a decimal string and three days of nanoseconds
 * (2.6e14) is past the point where a `number` still means what the tipster typed. Rounded to whole
 * seconds, which is the finest granularity a check-in interval has any use for.
 */
export const daysToNs = (days: number): string => {
  if (!Number.isFinite(days) || days <= 0) {
    throw new RangeError(`a switch interval must be a positive number of days, got ${days}`);
  }
  return (BigInt(Math.round(days * SECONDS_PER_DAY)) * NS_PER_SECOND).toString();
};
