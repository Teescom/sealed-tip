// PRIVACY INVARIANT 3: tipster pages load nothing from third parties (S-10.1).
//
// The CSP itself is NOT here — see `proxy.ts` and `lib/csp.ts`. A config file is read once at build
// time and the policy needs a per-request nonce, because the App Router's own inline scripts are part of
// every page; without it the browser refuses them and no page ever boots. Everything that does not need to
// vary per request still belongs in this file.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// The judge builds from the monorepo root, where `.env` lives, but Next only reads `apps/web/.env*`.
// Without this every NEXT_PUBLIC_* is undefined and `/p/[id]` and `/submit/[programme]` render
// "NEXT_PUBLIC_SEALEDTIP_CONTRACT is not set" from a perfectly good checkout. Only the public keys are
// copied forward: the root `.env` also holds relayer and keeper keys, and a build has no business seeing
// those. Values already in the environment win, which is what makes a Vercel deployment keep its own.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const file of [".env", ".env.local"]) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/.exec(raw);
    const key = match?.[1];
    if (key === undefined || process.env[key] !== undefined) continue;
    process.env[key] = (match?.[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
}

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
