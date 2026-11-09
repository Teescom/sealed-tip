// PRIVACY INVARIANT 3: tipster pages load nothing from third parties (S-10.1).
//
// The CSP itself is NOT here — see `proxy.ts` and `lib/csp.ts`. A config file is read once at build
// time and the policy needs a per-request nonce, because the App Router's own inline scripts are part of
// every page; without it the browser refuses them and no page ever boots. Everything that does not need to
// vary per request still belongs in this file.
import type { NextConfig } from "next";

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
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default config;
