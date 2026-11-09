// Tests for S-10.1: the CSP every page is served with (privacy invariant 3).
//
// What this file used to assert — that `next.config.ts` contains a `script-src 'self' 'wasm-unsafe-eval'`
// string — passed on the same build that no browser could boot. The policy was right and the pages were
// dead: Next ships each page's routing payload in inline scripts, the nonceless header refused them, and
// `/p/0`, `/status` and `/submit/0` sat on their "Loading…" shells with six violations in the console
// (measured 2026-11-09 in both `next dev` and `next start`). So the tests below are about what a page
// actually receives: the nonce is there, `'unsafe-inline'` is not, one place owns the header, and an env
// value cannot smuggle a directive into it.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it } from "vitest";

import nextConfig from "../next.config";
import { API_ORIGIN_DEFAULT, RPC_ORIGIN_DEFAULT } from "../lib/config";
import { contentSecurityPolicy, newNonce } from "../lib/csp";

const directive = (csp: string, name: string): string => {
  const found = csp.split("; ").find((part) => part.startsWith(`${name} `));
  assert.ok(found !== undefined, `the policy has no ${name} directive: ${csp}`);
  return found;
};

describe("Content-Security-Policy (S-10.1)", () => {
  it("admits exactly this request's nonce and nothing else inline", () => {
    const nonce = "aU5hU25vbmNlMTIz";
    const csp = contentSecurityPolicy(nonce);
    const scriptSrc = directive(csp, "script-src");

    assert.match(scriptSrc, /'self'/);
    // libsodium.js is wasm, and the browser will not run it without this named.
    assert.match(scriptSrc, /'wasm-unsafe-eval'/);
    assert.ok(scriptSrc.includes(`'nonce-${nonce}'`), `no nonce in ${scriptSrc}`);
    // The line this change exists to keep: a nonce and 'unsafe-inline' in one policy means the browser
    // ignores the nonce and executes any injected string.
    assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
    assert.doesNotMatch(scriptSrc, /'unsafe-eval'/);
    assert.doesNotMatch(scriptSrc, /'none'/);
  });

  it("keeps every other fetch on this origin, the relayer and the RPC node", () => {
    const csp = contentSecurityPolicy(newNonce());
    assert.equal(directive(csp, "default-src"), "default-src 'self'");
    assert.equal(directive(csp, "connect-src"), `connect-src 'self' ${API_ORIGIN_DEFAULT} ${RPC_ORIGIN_DEFAULT}`);
    assert.equal(directive(csp, "worker-src"), "worker-src 'self' blob:");
    assert.equal(directive(csp, "font-src"), "font-src 'self'");
    assert.equal(directive(csp, "img-src"), "img-src 'self' blob: data:");
    assert.doesNotMatch(csp, /(cdn|unpkg|jsdelivr|googleapis|cloudflare|analytics)/i);
  });

  it("refuses to frame, to be framed, and to post anywhere but itself", () => {
    const csp = contentSecurityPolicy(newNonce());
    assert.equal(directive(csp, "frame-ancestors"), "frame-ancestors 'none'");
    assert.equal(directive(csp, "base-uri"), "base-uri 'none'");
    assert.equal(directive(csp, "form-action"), "form-action 'self'");
  });

  /** A deployment writes these two variables, and they land inside a security header. A value that is not
   * a resolvable http(s) origin contributes nothing but the default — the policy cannot be extended by
   * somebody's copy-paste. */
  it("takes only the origin from an endpoint variable, never its punctuation", () => {
    const previous = { ...process.env };
    try {
      process.env.NEXT_PUBLIC_API_URL = "http://localhost:8787; script-src 'unsafe-inline'";
      process.env.NEXT_PUBLIC_NEAR_RPC_URL = "file:///etc/passwd";
      const csp = contentSecurityPolicy(newNonce());
      assert.equal(directive(csp, "connect-src"), `connect-src 'self' ${API_ORIGIN_DEFAULT} ${RPC_ORIGIN_DEFAULT}`);
      // Scoped to the script directive on purpose: `style-src 'unsafe-inline'` is ours and stays, because
      // the pages set inline `style` attributes. What must not appear is an inline-script escape hatch.
      assert.doesNotMatch(directive(csp, "script-src"), /unsafe-inline/);
      assert.doesNotMatch(csp, /file:\/\//);
    } finally {
      for (const key of ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_NEAR_RPC_URL"]) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  /** Two `Content-Security-Policy` headers on one response are enforced as both at once, so a second,
   * nonceless copy anywhere — the config file being where it used to live — would block the scripts the
   * proxy's copy exists to admit. This is the check that would have caught the original bug. */
  it("is the only place the header is set", async () => {
    assert.ok(typeof nextConfig.headers === "function");
    const rules = await nextConfig.headers!();
    for (const rule of rules) {
      for (const header of rule.headers) {
        assert.notEqual(
          header.key.toLowerCase(),
          "content-security-policy",
          `${rule.source} sets a second Content-Security-Policy; the proxy owns this header`,
        );
      }
    }
    const global = rules.find((rule) => rule.source === "/:path*");
    assert.ok(global !== undefined, "the static privacy headers vanished with the CSP");
    assert.ok(global.headers.some((h) => h.key === "Referrer-Policy" && h.value === "no-referrer"));
    assert.ok(global.headers.some((h) => h.key === "Permissions-Policy" && /camera=\(\)/.test(h.value)));
  });

  it("issues a fresh nonce per call, encoded the way the header wants it", () => {
    const a = newNonce();
    const b = newNonce();
    assert.notEqual(a, b, "two requests share a nonce");
    assert.match(a, /^[A-Za-z0-9+/]+=*$/);
    assert.equal(Buffer.from(a, "base64").toString("utf8").length, 36, "a UUID, not a counter");
  });

  /** The nonce has to be written per request, which in Next 16.4.4 is `proxy.ts`; the `middleware.ts`
   * spelling of the same convention is deprecated and prints a build warning. A leftover copy beside it
   * would be a second per-request writer of one header, which browsers enforce as both at once. */
  it("has one per-request file, under the convention the build accepts", () => {
    const webRoot = fileURLToPath(new URL("..", import.meta.url));
    assert.ok(existsSync(join(webRoot, "proxy.ts")), "nothing sets the CSP per request");
    assert.ok(!existsSync(join(webRoot, "middleware.ts")), "a deprecated middleware.ts sits beside proxy.ts");
  });
});
