// POST /blob, GET /blob/:cid — ciphertext only, cap enforced while streaming, cid = sha256 (S-8.3).
import { Cid } from "@sealedtip/core";
import { Hono } from "hono";

import { TooLarge, plaintextContainer, readCapped, type BlobStore } from "../store/blob.js";

/**
 * The store is injected rather than imported: the same routes must run against the in-process store in
 * the demo and against a bucket in a deployment, and a route module that reaches for a global would make
 * that a rewrite instead of an argument.
 */
export const blobRoutes = (store: BlobStore): Hono => {
  const app = new Hono();

  app.post("/", async (c) => {
    let bytes: Uint8Array;
    try {
      bytes = await readCapped(c.req.raw.body, store.maxBytes);
    } catch (error) {
      if (error instanceof TooLarge) {
        // The size, never the content: a 413 that echoed the first megabyte of a refused upload would put
        // the evidence into the response body of a request the client is about to retry through a proxy log.
        return c.json({ error: `body over the cap: ${error.received} bytes, limit ${store.maxBytes}` }, 413);
      }
      throw error;
    }
    if (bytes.byteLength === 0) return c.json({ error: "empty body" }, 400);

    const container = plaintextContainer(bytes);
    if (container !== null) {
      return c.json(
        { error: `this store holds ciphertext only and the body begins with a ${container} header — seal it client-side first` },
        415,
      );
    }

    return c.json({ cid: await store.put(bytes), bytes: bytes.byteLength }, 201);
  });

  app.get("/:cid", async (c) => {
    const cid = c.req.param("cid");
    if (cid === undefined || !Cid.safeParse(cid).success) {
      return c.json({ error: "cid must be 64 hex characters" }, 400);
    }
    const bytes = await store.get(cid);
    if (bytes === null) return c.json({ error: "not found" }, 404);
    return new Response(bytes, {
      headers: { "content-type": "application/octet-stream", "content-length": String(bytes.byteLength) },
    });
  });

  return app;
};
