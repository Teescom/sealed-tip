// Every page gets the CSP with its own nonce (S-10.1, privacy invariant 3).
//
// This has to run per request rather than sit in `next.config.ts` for one reason: the nonce is per request,
// and a config file is read once at build time. It also has to be the *only* place the header is set — a
// response carrying two `Content-Security-Policy` headers is enforced as both, so a leftover nonceless copy
// in the config would re-block the scripts this one exists to admit.
import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy, newNonce } from "./lib/csp";

export const proxy = (request: NextRequest) => {
  const csp = contentSecurityPolicy(newNonce());
  // Both copies, not just the response one. The response header is what the browser enforces; the request
  // header is how the render on the other side of this proxy learns the nonce and stamps it onto the inline
  // scripts it is about to emit. With only the response copy — which is what this file did first — the
  // header carries a valid nonce, Next's scripts carry none, and the pages stay exactly as dead as the
  // nonceless policy they replaced.
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
};

export const config = { matcher: "/:path*" };
