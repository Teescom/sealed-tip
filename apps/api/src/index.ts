// Sealed Tip API: blobs (ciphertext only), relayer queue, stateless AI proxy, quote proxy (ARCHITECTURE §9).
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { noLogs } from "./middleware/no-logs.js";
import { blob } from "./routes/blob.js";
import { relay } from "./routes/relay.js";
import { ai } from "./routes/ai.js";
import { quote } from "./routes/quote.js";

const app = new Hono();
app.use("*", noLogs);
app.get("/health", (c) => c.json({ ok: true }));
app.route("/blob", blob);
app.route("/relay", relay);
app.route("/ai", ai);
app.route("/quote", quote);
serve({ fetch: app.fetch, port: Number(process.env.API_PORT ?? 8787) });
