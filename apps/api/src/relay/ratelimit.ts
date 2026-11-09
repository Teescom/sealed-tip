// Token buckets keyed by the tipster's claim pubkey, plus one shared bucket — never by IP (S-8.4).
//
// The key is the 32-byte ed25519 public key the tipster's 24 words derive to, hex-encoded: it is what
// the contract itself verifies actions against, so it is the only per-caller identity this service is
// allowed to have. ARCHITECTURE §9 asks for "per-IP-less rate limit (token bucket keyed by claim pubkey
// + global)" because an address would give the queue a log line that de-anonymises the very account the
// contract never saw.
//
// The shared bucket is the part that holds under attack. A caller can mint fresh keypairs as cheaply as
// it can mint requests, so per-key buckets alone are no limit at all — what bounds the work this service
// does for a flood, and what a relayed action really costs (the relayer pays the gas), is the global one.

export interface Allowance {
  readonly allowed: boolean;
  /** How long to wait before the token is there. Zero when allowed. */
  readonly retryAfterMs: number;
}

export interface RateLimitOptions {
  /** Tokens one claim key may spend at once, before the refill carries it. */
  readonly keyBurst: number;
  /** Sustained rate for one claim key, in tokens per second. */
  readonly keyPerSecond: number;
  readonly globalBurst: number;
  readonly globalPerSecond: number;
  /** Buckets to remember. Past this the least-recently-used one is dropped, so memory cannot grow unbounded. */
  readonly maxKeys?: number;
  readonly now?: () => number;
}

export interface RateLimiter {
  /**
   * Does the shared bucket have a token right now? Reads only: this is the cheap check that runs before
   * any signature work, and consuming a token there would let a flood of garbage be what exhausts the
   * limit that honest callers need.
   */
  hasGlobalCapacity(): boolean;
  /**
   * Spend one token from this claim key's bucket and one from the shared bucket, or neither. Refusing
   * without consuming matters: a request that is admitted to the queue is the only thing that costs
   * anyone anything.
   */
  allow(claimPubkeyHex: string): Allowance;
  /** Buckets held in memory. For the eviction test and for an operator's log line. */
  keys(): number;
}

interface Bucket {
  tokens: number;
  /** ms at which `tokens` was last correct, so refill is computed rather than remembered. */
  updated: number;
}

/** A full bucket costs nothing to forget, and forgetting a drained one would hand its owner tokens back. */
const refill = (bucket: Bucket, perSecond: number, burst: number, now: number): Bucket => {
  const elapsed = Math.max(0, now - bucket.updated) / 1000;
  return { tokens: Math.min(burst, bucket.tokens + elapsed * perSecond), updated: now };
};

const waitMs = (tokens: number, perSecond: number): number =>
  perSecond <= 0 ? Number.POSITIVE_INFINITY : Math.ceil(((1 - tokens) / perSecond) * 1000);

export const createRateLimiter = (options: RateLimitOptions): RateLimiter => {
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? 10_000;
  const buckets = new Map<string, Bucket>();
  let shared: Bucket = { tokens: options.globalBurst, updated: now() };

  const lruEvict = () => {
    if (buckets.size <= maxKeys) return;
    // Oldest-touched first. Under a deliberate flood of fresh keys this drops a drained bucket, which
    // gives its owner back a token early — the honest version of that tradeoff is that the shared
    // bucket is what a flood runs into, and it is not affected by evicting anything here.
    const stale = [...buckets.entries()].sort((a, b) => a[1].updated - b[1].updated).slice(0, buckets.size - maxKeys);
    for (const [key] of stale) buckets.delete(key);
  };

  return {
    hasGlobalCapacity: () => refill(shared, options.globalPerSecond, options.globalBurst, now()).tokens >= 1,

    allow: (claimPubkeyHex: string): Allowance => {
      const at = now();
      const key = refill(buckets.get(claimPubkeyHex) ?? { tokens: options.keyBurst, updated: at }, options.keyPerSecond, options.keyBurst, at);
      const global = refill(shared, options.globalPerSecond, options.globalBurst, at);
      if (key.tokens < 1 || global.tokens < 1) {
        // Neither is consumed, and the wait is whichever bucket is further from a token.
        return { allowed: false, retryAfterMs: Math.max(waitMs(key.tokens, options.keyPerSecond), waitMs(global.tokens, options.globalPerSecond)) };
      }
      buckets.set(claimPubkeyHex, { tokens: key.tokens - 1, updated: at });
      shared = { tokens: global.tokens - 1, updated: at };
      lruEvict();
      return { allowed: true, retryAfterMs: 0 };
    },

    keys: () => buckets.size,
  };
};

/**
 * The numbers a deployment runs with, chosen from what an honest tipster does rather than guessed at:
 * one `submit_tip`, a handful of `checkin`s a day and one `claim` is a burst of five and well under one
 * action a minute sustained. The shared bucket is what the two relayer accounts can actually afford to
 * send — every relayed action is a function call they pay gas for — so it is the tighter of the two by
 * design, and `pnpm spam` (S-11.4) is expected to be told to wait.
 */
export const RELAY_LIMITS = {
  keyBurst: 5,
  keyPerSecond: 1 / 60,
  globalBurst: 20,
  globalPerSecond: 4 / 60,
} as const;
