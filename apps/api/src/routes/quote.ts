// POST /quote — 1Click quote proxy (S-8.6)
import { Hono } from "hono";

export const quote = new Hono();
quote.all("*", (c) => c.json({ error: "not implemented: S-8.6" }, 501));
