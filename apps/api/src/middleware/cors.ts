// The tipster page and this API are different origins: localhost:3000 against localhost:8787 here, and the
// Vercel domain against the API host in a deployment. Without an allow-origin header the browser blocks
// every request, which was measured on 2026-11-13 — a `fetch` from the served page to `/health` failed with
// "Failed to fetch" while curl to the same URL answered 200.
//
// The allowance is written onto the FINISHED response, not onto the context. A route that returns
// `new Response(...)` directly — `GET /blob/:cid` does, to stream ciphertext with its own headers — never
// goes through `c.header()`, and the first version of this middleware set the headers on the context only:
// `/health` carried the allowance and `/blob/...` did not, so the panel could fetch nothing and reported it
// as "unable to unwrap the key" instead of a CORS failure.
//
// The list is explicit rather than `*`, and credentials are never allowed: this API holds no cookie and no
// session, so there is nothing a wildcard would leak, but an origin list still keeps a stranger's page from
// spending our relayers' gas. `Vary: Origin` is what stops a cache handing one origin's allowance to another.
import type { MiddlewareHandler } from "hono";

/** Where the page is served from during development. A deployment passes its own list. */
export const DEFAULT_WEB_ORIGINS: readonly string[] = ["http://localhost:3000", "http://127.0.0.1:3000"];

const allow = (headers: Headers, origin: string): void => {
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-max-age", "600");
};

export const cors = (origins: readonly string[] = DEFAULT_WEB_ORIGINS): MiddlewareHandler => async (c, next) => {
  const origin = c.req.header("origin");
  const allowed = origin !== undefined && origins.includes(origin);

  // A preflight is answered here and never reaches a route: it carries no body and needs no chain read,
  // and letting it through would make every OPTIONS a 404 the browser reads as a CORS failure.
  if (c.req.method === "OPTIONS") {
    if (allowed) allow(c.res.headers, origin);
    return c.body(null, 204);
  }

  await next();
  if (allowed) allow(c.res.headers, origin);
};
