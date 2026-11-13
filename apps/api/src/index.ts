// The entry point: env, then the app, then the listener. Nothing else may bind a port, so a test can drive
// the same routes without one (S-8.2). The app itself is built by `build.ts`, which the serverless handler
// shares — the only difference here is the `.env` file, which a container does not have.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { buildApp } from "./build.js";
import { loadEnv } from "./env.js";

// A container gets its environment from the platform; a laptop gets the repo-root `.env`, which is the
// source of truth (ARCHITECTURE §13). Reading the file is opt-in by presence, so a deployment without one
// still starts from `process.env` — and fails fast there if a name is missing.
const envFile = process.env.ENV_FILE ?? fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = loadEnv();
const { app } = buildApp(env);

serve({ fetch: app.fetch, port: env.API_PORT });
console.log(`tip-api listening on ${env.API_PORT} for ${env.SEALEDTIP_CONTRACT} on ${env.NEAR_NETWORK}`);
