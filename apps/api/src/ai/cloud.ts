// The three NEAR AI Cloud calls the redaction proxy makes, and nothing else (S-8.5, ARCHITECTURE §7).
//
// This module is transport only: it knows the URLs, the headers and the timeouts, and it interprets none
// of the answers. The report and the signature response are handed back as JSON for somebody else to
// read, because the party that reads them is the one with `@sealedtip/crypto` — which `project_structure.md`
// §5 keeps out of this process and ARCHITECTURE §14.4 explains a browser cannot verify in either. The proxy
// assembles evidence; it does not grade it.
//
// Two details here were measured rather than assumed, and both are load-bearing:
//   · `GET /v1/attestation/report` is public on cloud-api.near.ai and needs only `x-no-aliasing: true`, so
//     the bearer key is not sent to it. Fewer places a key appears is the whole rule.
//   · the chat completion body is serialized by the caller and sent as those exact bytes, because the
//     response signature is taken over sha256 of them. A re-serialization on the way out — even of the
//     same object — would change the hash and break the only binding that says *this* answer is for *this* ask.

import { asString, field, readJson, type Json } from "../json.js";

/** Measured by `pnpm verify-attestation -- --fetch <model>` and the OHTTP spike (ARCHITECTURE §14.4). */
export const CLOUD_API = "https://cloud-api.near.ai";

/** A stalled upstream must not hold a request open, because the tipster's page cannot tell that from a dead API. */
export const CLOUD_TIMEOUT_MS = 30_000;

/** Where it went wrong and what happened, in that order, because the caller's error text is the client's. */
export class UpstreamError extends Error {
  constructor(
    readonly where: string,
    readonly reason: string,
  ) {
    super(`${where}: ${reason}`);
  }
}

export interface ChatRequest {
  /** Already serialized, so that `request_text` in the bundle is the bytes that went on the wire. */
  body: string;
}

export interface ChatCompletion {
  /** `id` from the completion response, which is what `GET /v1/signature/<chat_id>` is asked about. */
  chatId: string;
  /** The raw response body, stored so a verifier can recompute sha256 over it. */
  responseText: string;
}

export interface Cloud {
  report(model: string, nonce: string): Promise<Json>;
  complete(request: ChatRequest): Promise<ChatCompletion>;
  signature(chatId: string): Promise<Json>;
}

export interface CloudOptions {
  readonly apiKey: string;
  readonly base?: string;
  readonly timeoutMs?: number;
  /** The seam `ai-cloud.test.ts` uses: a proxy that cannot have its transport swapped can only be tested against production. */
  readonly fetchFn?: (input: string, init: RequestInit) => Promise<Response>;
}

export const nearAiCloud = (options: CloudOptions): Cloud => {
  const base = options.base ?? CLOUD_API;
  const timeoutMs = options.timeoutMs ?? CLOUD_TIMEOUT_MS;
  const send = options.fetchFn ?? ((input, init) => fetch(input, init));

  const call = async (where: string, url: string, init: RequestInit): Promise<Response> => {
    let response: Response;
    try {
      response = await send(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // The cause is never in the message. A fetch failure can carry the URL it was trying to reach, and a
      // URL built out of the tipster's text would carry that text into whatever prints the error.
      const timeout = error instanceof Error && error.name === "TimeoutError";
      throw new UpstreamError(where, timeout ? `no answer within ${timeoutMs}ms` : "could not be reached");
    }
    if (!response.ok) throw new UpstreamError(where, `HTTP ${response.status}`);
    return response;
  };

  return {
    // No Authorization: the report endpoint answered an unauthenticated request when it was measured
    // (ROADMAP S-0.3), and a key sent to an endpoint that does not need it is a key in one more log.
    report: async (model, nonce) => {
      const url =
        `${base}/v1/attestation/report?model=${encodeURIComponent(model)}` +
        `&nonce=${encodeURIComponent(nonce)}&signing_algo=ecdsa`;
      const response = await call("attestation report", url, { headers: { "x-no-aliasing": "true" } });
      return (await response.json()) as Json;
    },

    complete: async ({ body }) => {
      const response = await call("chat completion", `${base}/v1/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body,
      });
      const responseText = await response.text();
      const chatId = readChatId(responseText);
      if (chatId === undefined) throw new UpstreamError("chat completion", "the answer carried no chat id");
      return { chatId, responseText };
    },

    signature: async (chatId) => {
      const url = `${base}/v1/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`;
      const response = await call("response signature", url, {
        headers: { authorization: `Bearer ${options.apiKey}` },
      });
      return (await response.json()) as Json;
    },
  };
};

const readChatId = (responseText: string): string | undefined => {
  const id = asString(field(readJson(responseText), "id"));
  return id !== undefined && id.length > 0 ? id : undefined;
};

/** `choices[0].message.content`, if the answer has one; anything else is the caller's to report. */
export const completionContent = (responseText: string): string | undefined => {
  const choices = field(readJson(responseText), "choices");
  const first = Array.isArray(choices) ? choices[0] : undefined;
  return asString(field(field(first, "message"), "content"));
};
