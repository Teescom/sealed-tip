// PRIVACY INVARIANT 3: tipster pages load nothing from third parties. Strict CSP on every route (S-10.1).
import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
const rpcUrl = process.env.NEXT_PUBLIC_NEAR_RPC_URL || "https://rpc.testnet.near.org";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' ${apiUrl} ${rpcUrl}`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "worker-src 'self' blob:",
].join("; ");

const config: NextConfig = {
  transpilePackages: ["@sealedtip/core", "@sealedtip/crypto", "@sealedtip/clean"],
  poweredByHeader: false,
  webpack(config) {
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
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
