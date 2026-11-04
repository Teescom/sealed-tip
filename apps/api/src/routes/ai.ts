// POST /ai/redact — stateless proxy to NEAR AI Cloud + attestation bundle; keeps nothing (S-8.5)
import { Hono } from "hono";

export const ai = new Hono();
ai.all("*", (c) => c.json({ error: "not implemented: S-8.5" }, 501));
