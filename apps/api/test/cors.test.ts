// The browser enforces this and curl does not, which is why it needs a test rather than a live check: the
// day the allow-list is wrong the API still answers 200 to every tool that is not a browser, and the page
// dies on its first fetch (measured 2026-11-13).
import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";

import { createApp } from "../src/app.js";
import { quoteRoutes } from "../src/routes/quote.js";
import { memoryBlobStore } from "../src/store/blob.js";

const app = (origins?: readonly string[]) =>
  createApp({
    blobs: memoryBlobStore(1024),
    relay: new Hono(),
    ai: new Hono(),
    quote: quoteRoutes({ quoter: null }),
    ...(origins === undefined ? {} : { origins }),
  });

const preflight = (origin: string) =>
  new Request("http://api.test/relay/submit", {
    method: "OPTIONS",
    headers: { origin, "access-control-request-method": "POST" },
  });

test("an allowed origin is echoed back, so the page's fetch is not blocked", async () => {
  const response = await app(["http://localhost:3000"]).request("/health", { headers: { origin: "http://localhost:3000" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.equal(response.headers.get("vary"), "Origin", "a cache must not hand one origin's allowance to another");
});

test("an origin that is not on the list gets no allowance", async () => {
  const response = await app(["http://localhost:3000"]).request("/health", { headers: { origin: "https://evil.test" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("a request with no origin at all is untouched, because curl is not a browser", async () => {
  const response = await app(["http://localhost:3000"]).request("/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("a preflight is answered 204 with the methods and headers the flow needs", async () => {
  const response = await app(["http://localhost:3000"]).request(preflight("http://localhost:3000"));
  assert.equal(response.status, 204, "a 404 here is what the browser reports as a CORS failure");
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /content-type/i);
});

test("the default list is where the page runs in development, and credentials are never allowed", async () => {
  const response = await app().request("/health", { headers: { origin: "http://127.0.0.1:3000" } });
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:3000");
  assert.equal(response.headers.get("access-control-allow-credentials"), null, "there is no cookie or session to protect");
});

test("a route that builds its own Response still carries the allowance", async () => {
  // The blob route returns `new Response(bytes, ...)` to stream ciphertext, which never passes through
  // `c.header()`. Measured 2026-11-13: /health had the allowance and /blob/... did not, so the panel's
  // fetch was blocked and the page reported it as a decryption failure.
  const blobs = memoryBlobStore(1024);
  const cid = await blobs.put(new Uint8Array([1, 2, 3]));
  const built = createApp({ blobs, relay: new Hono(), ai: new Hono(), quote: quoteRoutes({ quoter: null }) });
  const response = await built.request(`/blob/${cid}`, { headers: { origin: "http://localhost:3000" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.equal(new Uint8Array(await response.arrayBuffer()).length, 3);
});
