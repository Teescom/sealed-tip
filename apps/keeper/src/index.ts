// The keeper process (S-9.1–S-9.3): heartbeat, switch watch, release. Wiring only — every rule that
// decides anything lives in the module it belongs to, so a test can drive the same behaviour against
// fakes without a node, a bucket or a timer.
//
// This is the one service in the repository that holds a key which can complete a dead man's switch and a
// secret that opens a bundle key, so the two lines it prints at startup name the accounts it acts as and
// nothing else. Trusted in the hackathon build; the production plan is a TEE (ARCHITECTURE §9).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createViewClient } from "@sealedtip/core";
import { x25519PublicKey } from "@sealedtip/crypto";

import { apiBlobs } from "./blobs.js";
import { loadEnv } from "./env.js";
import { startHeartbeat } from "./heartbeat.js";
import { keeperCall } from "./near.js";
import { release } from "./release.js";
import { startWatch } from "./watch.js";

const envFile = process.env.ENV_FILE ?? fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = loadEnv();

/**
 * `env.ts` has already refused anything that is not 64 lowercase hex, and this decodes without echoing:
 * the shared `fromHex` quotes a prefix of what it rejected, which is a reasonable message for a CID and
 * not one for a secret key.
 */
const decodeSecret = (hex: string): Uint8Array =>
  Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));

const views = createViewClient(env.NEAR_RPC_URL, env.SEALEDTIP_CONTRACT);
const blobs = apiBlobs(env.KEEPER_API_URL);
const call = keeperCall({
  account: env.KEEPER_ACCOUNT,
  secretKey: env.KEEPER_KEY,
  rpcUrl: env.NEAR_RPC_URL,
  contract: env.SEALEDTIP_CONTRACT,
});

const secret = decodeSecret(env.KEEPER_X25519_SECRET);
const keeperX25519 = { secret, publicKey: await x25519PublicKey(secret) };

const heartbeat = startHeartbeat({ call, intervalMs: env.KEEPER_HEARTBEAT_S * 1000 });

const watch = startWatch({
  views,
  intervalMs: env.KEEPER_WATCH_S * 1000,
  onTriggered: async (tipId) => {
    const outcome = await release(tipId, { views, blobs, call, keeperX25519 });
    console.log(
      "skipped" in outcome
        ? `keeper: tip ${tipId} already has released keys, left alone`
        : `keeper: released tip ${tipId} to ${outcome.posted.length} panel member(s), tx ${outcome.txHash}`,
    );
  },
});

console.log(`keeper running as ${env.KEEPER_ACCOUNT} against ${env.SEALEDTIP_CONTRACT} on ${env.NEAR_NETWORK}`);

const shutDown = (): void => {
  heartbeat.stop();
  watch.stop();
};
process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
