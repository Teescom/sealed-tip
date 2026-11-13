// Vercel serverless entry for the tip API. This project's functions are served under the `/api` prefix
// (Vercel mounts `api/*` there), so the app is built with `basePath: "/api"` and the web app's
// `NEXT_PUBLIC_API_URL` points at `https://<this-project>.vercel.app/api`. The cron in `vercel.json` hits
// `/api/cron/relay`.
import { getRequestListener } from "@hono/node-server";

import { buildApp } from "../src/build.js";
import { loadEnv } from "../src/env.js";

const { app } = buildApp(loadEnv(), { basePath: "/api" });

export default getRequestListener(app.fetch);
