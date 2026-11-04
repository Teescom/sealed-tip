// PRIVACY INVARIANT 2: no IPs, no x-forwarded-for, no bodies, no tipster identifiers in any log (S-8.1).
// Applied to EVERY route. test/no-logs.test.ts asserts it.
import type { MiddlewareHandler } from "hono";

export const noLogs: MiddlewareHandler = async (_c, next) => {
  // TODO(S-8.1): strip forwarding headers before handlers run; never call a request logger.
  await next();
};
