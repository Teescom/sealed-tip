// POST /blob, GET /blob/:cid — ciphertext only, 25 MB cap, cid = sha256 (S-8.3)
import { Hono } from "hono";

export const blob = new Hono();
blob.all("*", (c) => c.json({ error: "not implemented: S-8.3" }, 501));
