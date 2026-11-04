// PRIVACY INVARIANT 3: tipster pages load nothing from third parties. Strict CSP on every route (S-10.1).
import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  "script-src 'self'",            // TODO(S-10.1): nonce-based if Next needs inline scripts; never a CDN
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' " + (process.env.NEXT_PUBLIC_API_URL ?? "") + " " + (process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? ""),
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  transpilePackages: ["@sealedtip/core", "@sealedtip/crypto", "@sealedtip/clean"],
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default config;
