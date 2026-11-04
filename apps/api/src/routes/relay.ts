// POST /relay/:action — queue signed tipster actions with a random delay (S-8.4)
import { Hono } from "hono";

export const relay = new Hono();
relay.all("*", (c) => c.json({ error: "not implemented: S-8.4" }, 501));
