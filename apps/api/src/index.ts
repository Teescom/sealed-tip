// The entry point: env, then the app, then the listener. Nothing else may bind a port, so a test can drive
// the same routes without one (S-8.2).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { createViewClient } from "@sealedtip/core";

import { createApp } from "./app.js";
import { nearAiCloud } from "./ai/cloud.js";
import { createRedactor } from "./ai/redact.js";
import { loadEnv } from "./env.js";
import { createQueue, randomDelayMs } from "./relay/queue.js";
import { RELAY_LIMITS, createRateLimiter } from "./relay/ratelimit.js";
import { createSubmitter } from "./relay/submit.js";
import { aiRoutes } from "./routes/ai.js";
import { relayRoutes } from "./routes/relay.js";
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

// The two relayer keys are what this service spends, so they are read here and nowhere else: `createApp`
// takes a built relay app, which keeps a test able to drive the same routes against a fake chain without
// either importing this file or binding a port (S-8.1, S-8.4).
const submitter = createSubmitter({
  contract: env.SEALEDTIP_CONTRACT,
  rpcUrl: env.NEAR_RPC_URL,
  relayers: [
    { account: env.RELAYER_A_ACCOUNT, secretKey: env.RELAYER_A_KEY },
    { account: env.RELAYER_B_ACCOUNT, secretKey: env.RELAYER_B_KEY },
  ],
});

const views = createViewClient(env.NEAR_RPC_URL, env.SEALEDTIP_CONTRACT);

const relay = relayRoutes({
  context: { contract: env.SEALEDTIP_CONTRACT, tipReader: (tipId) => views.getTipForPanel(tipId) },
  // The limits are constants chosen from what an honest tipster does; the only numbers the operator picks
  // are the delay range, because that is the one that has to change between a demo and a deployment.
  limiter: createRateLimiter(RELAY_LIMITS),
  queue: createQueue({
    delayMs: () => randomDelayMs(env.RELAY_DELAY_MIN_S, env.RELAY_DELAY_MAX_S),
    send: (action) => submitter.submit(action.method, action.args),
    // Method name and the error's own message. Not the args: they carry a claim pubkey and a signature,
    // and this is the one relay path guaranteed to write to stdout.
    onUndelivered: (action, error) =>
      console.error(`relay dropped ${action.method}: ${error instanceof Error ? error.message : String(error)}`),
  }),
});

// The optional AI step (S-8.5). The key is the one secret this service holds for somebody else's model, so
// the proxy is built only when it exists and the route answers 503 when it does not — the tip flow works
// without the redaction suggestion, and a deployment that has not decided to pay for inference should not
// be told it must.
const ai = aiRoutes({
  redactor:
    env.NEAR_AI_API_KEY === undefined
      ? null
      : createRedactor({
          cloud: nearAiCloud({ apiKey: env.NEAR_AI_API_KEY }),
          ...(env.NEAR_AI_MODEL === undefined ? {} : { defaultModel: env.NEAR_AI_MODEL }),
        }),
});

serve({
  fetch: createApp({ blobs: memoryBlobStore(env.BLOB_MAX_BYTES), relay, ai }).fetch,
  port: env.API_PORT,
});
console.log(`tip-api listening on ${env.API_PORT} for ${env.SEALEDTIP_CONTRACT} on ${env.NEAR_NETWORK}`);
