// PRIVACY INVARIANT 2: no IPs, no x-forwarded-for, no bodies, no tipster identifiers in any log (S-8.1).
// Applied to EVERY route by `createApp`, before any handler runs.
import type { MiddlewareHandler } from "hono";

/**
 * The headers a proxy in front of this API will set and a log line will happily repeat. An address is
 * the one identifier a tipster cannot rotate the way they rotate a key, and the contract never sees any
 * of it — so it is dropped at the door rather than left for each handler to remember.
 */
export const STRIPPED_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "forwarded",
  "cf-connecting-ip",
  "cf-ipcountry",
  "true-client-ip",
] as const;

/**
 * Replaces the request with one whose header list no longer contains them. `new Request(raw, { headers })`
 * carries the method and the body stream over untouched, which the second test in `no-logs.test.ts`
 * exists to keep true — a "privacy fix" that ate the uploaded ciphertext would be worse than no fix.
 */
export const noLogs: MiddlewareHandler = async (c, next) => {
  const headers = new Headers(c.req.raw.headers);
  for (const name of STRIPPED_HEADERS) headers.delete(name);
  c.req.raw = new Request(c.req.raw, { headers });
  await next();
};
