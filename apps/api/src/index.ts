// The entry point: env, then the app, then the listener. Nothing else may bind a port, so a test can drive
// the same routes without one (S-8.2).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { memoryBlobStore } from "./store/blob.js";

// A container gets its environment from the platform; a laptop gets the repo-root `.env`, which is the
// source of truth (ARCHITECTURE §13). Reading the file is opt-in by presence, so a deployment without one
// still starts from `process.env` — and fails fast there if a name is missing.
const envFile = process.env.ENV_FILE ?? fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = loadEnv();

// ARCHITECTURE §2 names Vercel Blob or an S3-compatible bucket for a deployed API. Until one is actually
// wired, a deployment that sets the URL has to be told it is not getting it: silently buffering 25 MB
// blobs in the process would look like a working store until the first restart deleted every exhibit.
if (env.BLOB_STORE_URL !== undefined) {
  throw new Error(
    `BLOB_STORE_URL is set, but this build only ships the in-process store — the external adapter is not written yet, ` +
      `and blobs uploaded here do not survive a restart. Unset it for the demo, or wire the adapter in src/store/blob.ts.`,
  );
}

serve({ fetch: createApp({ blobs: memoryBlobStore(env.BLOB_MAX_BYTES) }).fetch, port: env.API_PORT });
console.log(`tip-api listening on ${env.API_PORT} for ${env.SEALEDTIP_CONTRACT} on ${env.NEAR_NETWORK}`);
