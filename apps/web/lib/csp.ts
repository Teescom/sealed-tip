// The Content-Security-Policy every page is served with (S-10.1, privacy invariant 3).
//
// Why this is a function of a nonce rather than a constant in `next.config.ts`: the App Router ships the
// page's routing payload in inline `<script>` tags, and a `script-src 'self' 'wasm-unsafe-eval'` policy
// refuses those. What that looked like in a browser, measured on 2026-11-09: every route returned 200, the
// static landing copy rendered, and `/p/0`, `/status` and `/submit/0` stayed on their server-rendered
// "Loading…" shells forever with six CSP violations in the console — no client code ever ran, so nothing
// that reads the chain, cleans a file, or signs a tip worked. A header string in a config file passed the
// test; the page did not boot.
//
// The nonce is per request and is what Next stamps onto its own inline scripts, so the only inline code
// that executes is the code this build emitted. `'unsafe-inline'` would have made the pages work the same
// way and unmade the point of the header: with a CSP that allows inline script, any injected string into
// the page is arbitrary code on the tipster's machine, which is where their secret and their plaintext
// live.
import { API_ORIGIN_DEFAULT, RPC_ORIGIN_DEFAULT } from "./config.js";

const nonceToken = (nonce: string): string => `'nonce-${nonce}'`;

/**
 * The `http(s)` origin of an env-supplied endpoint, or the documented default.
 *
 * The two URLs come from build variables a deployment writes, and they land inside a security header.
 * Taking the origin that a URL parser resolves — not the string it was given — is what stops a value like
 * `http://localhost:8787; script-src 'unsafe-inline'` from becoming policy.
 */
const originOf = (value: string | undefined, fallback: string): string => {
  try {
    const url = new URL(value ?? fallback);
    if (url.protocol !== "http:" && url.protocol !== "https:") return new URL(fallback).origin;
    return url.origin;
  } catch {
    return new URL(fallback).origin;
  }
};

export const contentSecurityPolicy = (nonce: string): string => {
  const api = originOf(process.env.NEXT_PUBLIC_API_URL, API_ORIGIN_DEFAULT);
  const rpc = originOf(process.env.NEXT_PUBLIC_NEAR_RPC_URL, RPC_ORIGIN_DEFAULT);
  return [
    "default-src 'self'",
    // libsodium.js compiles to wasm, and the browser only lets a wasm module stream from a buffer it can
    // execute — which this directive has to permit by name or the crypto silently never loads.
    `script-src 'self' 'wasm-unsafe-eval' ${nonceToken(nonce)}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${api} ${rpc}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
};

/** A per-request nonce. `crypto.randomUUID` is 122 bits of randomness from the platform, not a counter. */
export const newNonce = (): string => Buffer.from(crypto.randomUUID()).toString("base64");
