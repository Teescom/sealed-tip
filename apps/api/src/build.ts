// One place that turns a validated env into the wired app, so the laptop listener and the serverless
// handler share it (S-8.2). The deployment decisions live here: Vercel Blob vs the in-process store, the
// durable KV queue vs the in-process one, and whether the cron route is mounted at all.
import { createViewClient } from "@sealedtip/core";
import type { Hono } from "hono";

import { nearAiCloud } from "./ai/cloud.js";
import { createRedactor } from "./ai/redact.js";
import { createApp } from "./app.js";
import type { Env } from "./env.js";
import { createQuoter } from "./quote/oneclick.js";
import { vercelKv } from "./relay/kv.js";
import { kvRelayQueue } from "./relay/kv-queue.js";
import { createQueue, randomDelayMs, type QueuedAction, type RelayQueue } from "./relay/queue.js";
import { RELAY_LIMITS, createRateLimiter } from "./relay/ratelimit.js";
import { createSubmitter } from "./relay/submit.js";
import { aiRoutes } from "./routes/ai.js";
import { cronRoutes } from "./routes/cron.js";
import { quoteRoutes } from "./routes/quote.js";
import { relayRoutes } from "./routes/relay.js";
import { memoryBlobStore } from "./store/blob.js";
import { vercelBlobClient, vercelBlobStore } from "./store/vercel-blob.js";

export interface BuiltApp {
  readonly app: Hono;
  readonly relayQueue: RelayQueue;
}

export interface BuildOptions {
  /** Prefix every route (a Vercel function is mounted under /api, the laptop listener is not). */
  readonly basePath?: string;
}

export const buildApp = (env: Env, options: BuildOptions = {}): BuiltApp => {
  const origins = env.WEB_ORIGIN?.split(",").map((value) => value.trim()).filter((value) => value.length > 0);

  // Ciphertext store: Vercel Blob when the token exists, else the in-process demo store. The old
  // BLOB_STORE_URL/BLOB_TOKEN pair is still parsed but no longer decides anything — the adapter is chosen
  // by the token that Vercel Blob actually speaks.
  const blobs =
    env.BLOB_READ_WRITE_TOKEN === undefined
      ? memoryBlobStore(env.BLOB_MAX_BYTES)
      : vercelBlobStore(env.BLOB_MAX_BYTES, vercelBlobClient(env.BLOB_READ_WRITE_TOKEN));

  // The two relayer keys are what this service spends, so they are read here and nowhere else (S-8.1).
  const submitter = createSubmitter({
    contract: env.SEALEDTIP_CONTRACT,
    rpcUrl: env.NEAR_RPC_URL,
    relayers: [
      { account: env.RELAYER_A_ACCOUNT, secretKey: env.RELAYER_A_KEY },
      { account: env.RELAYER_B_ACCOUNT, secretKey: env.RELAYER_B_KEY },
    ],
  });

  const views = createViewClient(env.NEAR_RPC_URL, env.SEALEDTIP_CONTRACT);

  const delayMs = () => randomDelayMs(env.RELAY_DELAY_MIN_S, env.RELAY_DELAY_MAX_S);
  const send = (action: QueuedAction) => submitter.submit(action.method, action.args);
  const onUndelivered = (action: QueuedAction, error: unknown) =>
    console.error(`relay dropped ${action.method}: ${error instanceof Error ? error.message : String(error)}`);

  // The queue is the one piece that changes meaning between laptop and deployment: a setTimeout cannot
  // survive a serverless cold start, so the deployment writes the action with a "not before" score to KV
  // and a cron sends what is due.
  const durableQueue =
    env.KV_REST_API_URL !== undefined && env.KV_REST_API_TOKEN !== undefined
      ? kvRelayQueue({ kv: vercelKv(env.KV_REST_API_URL, env.KV_REST_API_TOKEN), delayMs, send, onUndelivered })
      : undefined;
  const relayQueue: RelayQueue = durableQueue ?? createQueue({ delayMs, send, onUndelivered });

  const relay = relayRoutes({
    context: { contract: env.SEALEDTIP_CONTRACT, tipReader: (tipId) => views.getTipForPanel(tipId) },
    limiter: createRateLimiter(RELAY_LIMITS),
    queue: relayQueue,
  });

  const ai = aiRoutes({
    redactor:
      env.NEAR_AI_API_KEY === undefined
        ? null
        : createRedactor({
            cloud: nearAiCloud({ apiKey: env.NEAR_AI_API_KEY }),
            ...(env.NEAR_AI_MODEL === undefined ? {} : { defaultModel: env.NEAR_AI_MODEL }),
          }),
  });

  const quote = quoteRoutes({
    quoter:
      env.ONECLICK_API_KEY === undefined
        ? null
        : createQuoter({ apiKey: env.ONECLICK_API_KEY, refundTo: env.SEALEDTIP_CONTRACT }),
  });

  let app = createApp({
    blobs,
    relay,
    ai,
    quote,
    ...(origins === undefined || origins.length === 0 ? {} : { origins }),
  });

  if (durableQueue !== undefined && env.CRON_SECRET !== undefined) {
    app.route("/cron", cronRoutes({ secret: env.CRON_SECRET, queue: durableQueue }));
  }

  if (options.basePath !== undefined) app = app.basePath(options.basePath);

  return { app, relayQueue };
};
