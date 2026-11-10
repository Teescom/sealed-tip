# Sealed Tip — Vercel Web App Deployment Guide (Testnet)

> **Document Status:** Complete & Ready for Execution  
> **Associated Issue:** #153 (`[P12] Deploy the web app to Vercel (testnet)`) · **Roadmap Task:** `S-12.5`  
> **Rule Reminder (`AGENTS.md`):** Maintainer task. Ask before triggering live deployments. Done when: works on a phone.

---

## 1. Overview & Architecture

The Sealed Tip web tier is a **Next.js 16 (v16.4.4 App Router)** application styled with **Tailwind CSS v4** residing in `apps/web`. It integrates with internal workspace packages:
- `@sealedtip/core`: Contract schemas, zod validators, and JSON-RPC view client.
- `@sealedtip/crypto`: Client key derivation, ed25519 signing, XChaCha20-Poly1305 encryption, and PoW solver.
- `@sealedtip/clean`: Client-side rasterization and forensic metadata stripping (PDF/images).

Next.js is configured with `transpilePackages: ["@sealedtip/core", "@sealedtip/crypto", "@sealedtip/clean"]`, meaning it compiles TypeScript workspace dependencies directly from source during build without requiring pre-built `dist/` folders.

---

## 2. Vercel Project Configuration

When importing `github.com/Teescom/sealed-tip` into Vercel:

| Setting | Value | Notes |
|---|---|---|
| **Framework Preset** | Next.js | Automatically recognized. |
| **Root Directory** | `apps/web` | **Important:** Set Root Directory to `apps/web`. Vercel automatically detects the root `pnpm-workspace.yaml` and `pnpm-lock.yaml` and resolves monorepo packages. |
| **Build Command** | `next build --webpack` (or `pnpm --filter @sealedtip/web build`) | Standard Next.js 16 webpack build. |
| **Output Directory** | `.next` | Default for Next.js. |
| **Install Command** | `pnpm install` | Uses pnpm 9/11 from root. |
| **Node.js Version** | `22.x` | Set in Vercel General Settings (minimum Node 22 required per `package.json`). |

---

## 3. Environment Variables Matrix

Configure these environment variables in the Vercel Project Settings (**Environment Variables** ➔ Production & Preview):

| Variable Name | Required? | Recommended Testnet Value | Description |
|---|---|---|---|
| `NEXT_PUBLIC_NEAR_NETWORK` | Yes | `testnet` | Target NEAR blockchain environment (`testnet` / `mainnet`). |
| `NEXT_PUBLIC_NEAR_RPC_URL` | Yes | `https://rpc.testnet.fastnear.com` | FastNEAR high-throughput JSON-RPC endpoint. **Do NOT use `rpc.testnet.near.org`** (it returns 429 CORS errors on browser preflight). |
| `NEXT_PUBLIC_SEALEDTIP_CONTRACT` | Yes | `sealedtip.st-hack-f8d075.testnet` | Deployed Sealed Tip escrow contract on testnet. |
| `NEXT_PUBLIC_TOKEN_CONTRACT` | Yes | `tusdc.st-hack-f8d075.testnet` | Deployed mock tUSDC test token contract. |
| `NEXT_PUBLIC_API_URL` | Yes | `https://api.sealedtip.example.com` (or relayer host) | Host for stateless blob storage, relayer queue, and AI redaction proxy. Falls back to `http://localhost:8787` if omitted. |

> [!NOTE]
> All frontend variables use the `NEXT_PUBLIC_` prefix and are strictly public. `apps/web` contains **zero secrets, zero private keys, and zero relayer keys**.

---

## 4. Content-Security-Policy (CSP) & Privacy Invariants

Sealed Tip enforces **Privacy Invariant 3: Tipster pages load nothing from third parties (no analytics, CDNs, external fonts, or tracking scripts).**

### How CSP Works in Next.js 16
1. **Dynamic Per-Request Nonce:**
   - Pre-rendered static HTML cannot carry a dynamic nonce. Thus, `apps/web/app/layout.tsx` enforces `export const dynamic = "force-dynamic"`.
   - `apps/web/proxy.ts` (Next 16 modern replacement for `middleware.ts`) generates a cryptographically random UUID nonce on every request.
2. **Dual-Header Propagation:**
   - `proxy.ts` writes `Content-Security-Policy` to **both** the request headers (allowing Next.js server-renderer to stamp `<script nonce="...">`) and response headers (enforced by the browser).
3. **Directive Breakdown (`apps/web/lib/csp.ts`):**
   ```http
   default-src 'self';
   script-src 'self' 'wasm-unsafe-eval' 'nonce-<RANDOM_NONCE>';
   style-src 'self' 'unsafe-inline';
   img-src 'self' blob: data:;
   font-src 'self';
   connect-src 'self' https://<NEXT_PUBLIC_API_URL> https://rpc.testnet.fastnear.com;
   frame-ancestors 'none';
   base-uri 'none';
   form-action 'self';
   worker-src 'self' blob:;
   ```
4. **Critical Directive Explanations:**
   - `'wasm-unsafe-eval'`: Required for `libsodium-wrappers` WebAssembly cryptography to instantiate client-side.
   - `connect-src`: Dynamically includes only origin self, the FastNEAR RPC endpoint, and the tip API origin.
   - `font-src 'self'`: Custom font (`anton-latin.woff2`) is self-hosted same-origin; no Google Fonts or external CDNs.

---

## 5. Mobile Device Verification Checklist ("Works on a phone")

Issue #153 requires proving the app **works on a phone**. Verify against this checklist using iOS Safari and Android Chrome:

- [ ] **Viewport & Responsive Scaling:**
  - Viewport is constrained (`width=device-width, initial-scale=1, maximum-scale=5`).
  - No horizontal scrolling at 360px viewport width (e.g. iPhone SE / Galaxy A-series).
- [ ] **Touch Targets (WCAG 2.5.5 AAA):**
  - All actionable buttons, tab toggles, and copy buttons have minimum touch dimensions of `min-h-[44px]` and `min-w-[44px]`.
- [ ] **24 Recovery Words Grid:**
  - Displays as 2 columns on mobile, expanding to 3 on tablets and 4 on desktop screens.
  - "Copy all words" button copies payload cleanly to clipboard with visual feedback.
- [ ] **Client-Side Document Upload & Cleaning on Mobile:**
  - File picker supports mobile document selection and camera photo uploads.
  - Client-side canvas rasterization completes without memory exhaustion on mobile browsers.
  - Cleaning report displays clearly on mobile card layout.
- [ ] **Proof-of-Work Mining:**
  - 12-bit PoW mining runs client-side in a Web Worker without locking the mobile browser main thread.
- [ ] **Navigation & Forms:**
  - Touch target accessibility verified (`RecusalPicker`, `SwitchSettings`, `RedactionReview`).
  - Input text sizes ≥ 16px to prevent iOS Safari auto-zoom on focus.

---

## 6. Step-by-Step Deployment Instructions

### Method A: Via Vercel Web Dashboard (Recommended)
1. Go to [vercel.com/new](https://vercel.com/new).
2. Connect GitHub repository: `Teescom/sealed-tip`.
3. In **Project Settings**:
   - **Root Directory**: Click "Edit" and choose `apps/web`.
   - **Framework Preset**: Ensure "Next.js" is selected.
4. Expand **Environment Variables** and add:
   ```
   NEXT_PUBLIC_NEAR_NETWORK = testnet
   NEXT_PUBLIC_NEAR_RPC_URL = https://rpc.testnet.fastnear.com
   NEXT_PUBLIC_SEALEDTIP_CONTRACT = sealedtip.st-hack-f8d075.testnet
   NEXT_PUBLIC_TOKEN_CONTRACT = tusdc.st-hack-f8d075.testnet
   NEXT_PUBLIC_API_URL = https://api.sealedtip.example.com
   ```
5. Click **Deploy**.
6. Deployment builds in ~1m30s.

### Method B: Via Vercel CLI (For Maintainer)
```bash
# Navigate to web application directory
cd apps/web

# Link project to Vercel
npx vercel link

# Pull project environment / set production envs
npx vercel env add NEXT_PUBLIC_NEAR_NETWORK production
npx vercel env add NEXT_PUBLIC_NEAR_RPC_URL production
npx vercel env add NEXT_PUBLIC_SEALEDTIP_CONTRACT production
npx vercel env add NEXT_PUBLIC_TOKEN_CONTRACT production
npx vercel env add NEXT_PUBLIC_API_URL production

# Deploy to production
npx vercel --prod
```

---

## 7. Post-Deployment Smoke Test

Once deployed to `https://<deployment-name>.vercel.app`:

1. **Header & CSP Inspection:**
   ```bash
   curl -I https://<deployment-name>.vercel.app
   ```
   *Verify:* Response contains `Content-Security-Policy` with a unique `nonce-...`, `Referrer-Policy: no-referrer`, and `Permissions-Policy`.
2. **Landing Page:**
   Open in mobile browser. Ensure navigation buttons ("Submit Tip", "Check Status", "Review Panel") route smoothly.
3. **Submit Route (`/submit/1`):**
   - 24 words generate immediately without delay.
   - Upload sample test image. Verify cleaning report renders.
4. **Console Audit:**
   Open browser devtools. Verify **zero CSP violation warnings, zero failed network calls, and zero third-party domain requests**.
