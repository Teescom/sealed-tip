// Tests for S-10.1: Strict CSP headers (Privacy Invariant 3).
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import nextConfig from "../next.config";

describe("Content-Security-Policy & Privacy Headers (S-10.1)", () => {
  it("enforces strict CSP with wasm-unsafe-eval and no third parties", async () => {
    assert.ok(typeof nextConfig.headers === "function");
    const headersList = await nextConfig.headers();
    const globalRule = headersList.find((h) => h.source === "/:path*");
    assert.ok(globalRule !== undefined, "global header rule /:path* must exist");

    const cspHeader = globalRule.headers.find((h) => h.key === "Content-Security-Policy");
    assert.ok(cspHeader !== undefined, "Content-Security-Policy header must exist");
    const csp = cspHeader.value;

    // Invariant 3 requirements
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);
    assert.doesNotMatch(csp, /https?:\/\/[^;]*cdn/i);
    assert.match(csp, /worker-src 'self' blob:/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.match(csp, /form-action 'self'/);

    const referrerHeader = globalRule.headers.find((h) => h.key === "Referrer-Policy");
    assert.ok(referrerHeader !== undefined);
    assert.equal(referrerHeader.value, "no-referrer");

    const permissionsHeader = globalRule.headers.find((h) => h.key === "Permissions-Policy");
    assert.ok(permissionsHeader !== undefined);
    assert.match(permissionsHeader.value, /camera=\(\)/);
    assert.match(permissionsHeader.value, /microphone=\(\)/);
    assert.match(permissionsHeader.value, /geolocation=\(\)/);
  });
});
