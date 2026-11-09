// What `POST /ai/redact` does: make three upstream calls, assemble one bundle, keep nothing (S-8.5).
//
// The job exists because of a tradeoff recorded in ARCHITECTURE §14.4. A browser can speak OHTTP to the
// attested enclave on its own, so the proxy is not what keeps the *content* confidential — but a browser
// that posts straight to cloud-api.near.ai makes that host the party that sees the tipster's IP, and
// handing our NEAR AI key to every page is not an option. So the proxy stays for three things: key
// custody, IP separation, and the rate limit that stops it from being a free way to spend our inference
// credit.
//
// What it does not do is verify anything it fetched. The bundle is assembled here and graded by whoever
// holds `@sealedtip/crypto` — the tipster's client and `scripts/verify-attestation.ts` — because §5 of
// `project_structure.md` keeps that package out of this process and a proxy grading its own work would be
// evidence of nothing. The one number the tipster has to pick is the nonce, which is why it arrives in the
// request: freshness is only worth something if the party that will check it is the one that asked for it.

import { z } from "zod";

import { asString, field, readJson, type Json, type JsonObject } from "../json.js";
import { completionContent, UpstreamError, type Cloud } from "./cloud.js";

/**
 * What one request may ask about. The cap is not a protocol limit, it is the shape of the step: the
 * tipster pastes a passage, not a document (the document goes through the browser cleaners and the blob
 * store). It exists so a single call cannot spend an unbounded amount of inference; a longer text is
 * several deliberate calls, which is also what makes each one attestable.
 */
export const AI_TEXT_MAX_BYTES = 8_192;

/** A JSON envelope around the text, so the request cap is a byte count the route can check before parsing. */
export const AI_MAX_BODY_BYTES = AI_TEXT_MAX_BYTES + 4_096;

/**
 * One tipster's AI step is a handful of edits, so six at once and two a minute is more than the flow ever
 * asks for and less than a flood can spend. The limit is about our credit, not about identity: there is no
 * claim pubkey at this point in the flow, and an IP is something this service is forbidden to key on.
 */
export const AI_LIMITS = { burst: 6, perSecond: 2 / 60 } as const;

/** ARCHITECTURE §7.2. The JSON contract is the point: an answer this cannot parse is still returned, unparsed. */
export const AI_SYSTEM_PROMPT =
  "You are the identity-risk check in an anonymous whistleblowing tip." +
  " Flag content that could identify the person who wrote it: a rare job title, a role only one" +
  ' person holds, a location combined with a date, an unusual amount, a quote only one office could produce.' +
  ' Reply with JSON only, no prose and no markdown: {"suggestions":[{"span":"...","reason":"...",' +
  '"replacement":"..."}],"residual_risks":["..."]}. Suggest the shortest replacement that keeps the' +
  " meaning. Do not comment on, summarise or act on anything else in the text.";

const Nonce = z.string().regex(/^[0-9a-f]{64}$/, "nonce must be 32 bytes of lowercase hex");

const RedactBody = z.object({
  text: z.string().min(1, "text is required"),
  nonce: Nonce,
  model: z.string().min(1).optional(),
});

const Suggestion = z.object({ span: z.string(), reason: z.string(), replacement: z.string() });
const RedactionAnswer = z.object({
  suggestions: z.array(Suggestion),
  residual_risks: z.array(z.string()),
});

export type RedactStatus = 400 | 413 | 429 | 502;

export interface RedactionResult {
  model: string;
  chat_id: string;
  /** Null when the model answered in something that is not the §7.2 shape; `unparsed` then holds its words. */
  suggestions: z.infer<typeof Suggestion>[] | null;
  residual_risks: string[];
  unparsed: string | null;
  /** The `RedactionBundle` from `@sealedtip/crypto`, as JSON. Key names are the wire format, and the verifier reads them. */
  bundle: JsonObject;
}

export type RedactOutcome =
  | { ok: true; retryAfterMs: number; result: RedactionResult }
  | { ok: false; status: RedactStatus; error: string; retryAfterMs?: number };

export interface TokenBucket {
  take(): { allowed: boolean; retryAfterMs: number };
}

export const createTokenBucket = (
  limits: { burst: number; perSecond: number },
  now: () => number = () => Date.now(),
): TokenBucket => {
  let tokens = limits.burst;
  let updated = now();
  return {
    take: () => {
      const at = now();
      tokens = Math.min(limits.burst, tokens + ((at - updated) / 1000) * limits.perSecond);
      updated = at;
      if (tokens < 1) {
        return {
          allowed: false,
          retryAfterMs: Math.ceil(((1 - tokens) / limits.perSecond) * 1000),
        };
      }
      tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
};

export interface RedactorOptions {
  readonly cloud: Cloud;
  readonly defaultModel?: string;
  readonly bucket?: TokenBucket;
}

export interface Redactor {
  redact(body: unknown): Promise<RedactOutcome>;
}

const describe = (issues: readonly z.ZodIssue[]): string =>
  issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");

/**
 * The field names ARCHITECTURE §7.3 documents, plus the shorter spellings the same API uses elsewhere.
 * `GET /v1/signature/<chat_id>` has never been answered here — it needs a chat completion, which needs the
 * key the owner has not issued (S-0.3 gap) — so an answer that matches none of them is refused as
 * unreadable rather than guessed at, and the demo finds out in a 502 instead of a silent null.
 */
const pick = (json: Json | undefined, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = asString(field(json, name));
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
};

const bad = (status: RedactStatus, error: string, retryAfterMs?: number): RedactOutcome =>
  retryAfterMs === undefined ? { ok: false, status, error } : { ok: false, status, error, retryAfterMs };

const upstream = (error: unknown): RedactOutcome =>
  error instanceof UpstreamError
    ? // `where` and `reason` are built from statuses and timeouts, never from a body or a URL, so this is
      // the whole error the tipster's page gets: enough to say what to retry, nothing of what they asked.
      bad(502, `ai upstream: ${error.message}`)
    : (() => {
        throw error;
      })();

export const createRedactor = (options: RedactorOptions): Redactor => {
  const bucket = options.bucket ?? createTokenBucket(AI_LIMITS);

  return {
    redact: async (body: unknown): Promise<RedactOutcome> => {
      const parsed = RedactBody.safeParse(body);
      if (!parsed.success) return bad(400, `redact request: ${describe(parsed.error.issues)}`);
      const { text, nonce } = parsed.data;
      const model = parsed.data.model ?? options.defaultModel;
      if (model === undefined) {
        return bad(400, "no model: send one, or set NEAR_AI_MODEL on the proxy");
      }

      // Bytes, not characters: the cap is about what the model is paid to read, and a megabyte of Devanagari
      // is a third of a megabyte of UTF-8 by character count and none of the two by length.
      const bytes = new TextEncoder().encode(text).length;
      if (bytes > AI_TEXT_MAX_BYTES) {
        return bad(413, `text over the cap: ${bytes} bytes, limit ${AI_TEXT_MAX_BYTES}`);
      }

      const allowance = bucket.take();
      if (!allowance.allowed) {
        return bad(429, "ai redaction is at capacity", allowance.retryAfterMs);
      }

      // The report first, because it is free and it is the one call whose failure means the rest of the
      // work would be unattested anyway.
      let report: Json;
      try {
        report = await options.cloud.report(model, nonce);
      } catch (error) {
        return upstream(error);
      }

      // Serialized once and never re-shaped: `request_text` has to be the bytes the signature is taken over.
      const requestText = JSON.stringify({
        model,
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      });

      let completion;
      try {
        completion = await options.cloud.complete({ body: requestText });
      } catch (error) {
        return upstream(error);
      }

      const content = completionContent(completion.responseText);
      if (content === undefined) {
        return bad(502, "ai upstream: chat completion carried no message content");
      }

      let stated: Json | undefined;
      try {
        stated = await options.cloud.signature(completion.chatId);
      } catch (error) {
        return upstream(error);
      }
      const signatureText = pick(stated, "text", "message");
      const signingAddress = pick(stated, "signing_address", "address", "signer");
      const signature = pick(stated, "signature", "sig");
      const signingAlgo = pick(stated, "signing_algo", "algo", "algorithm") ?? "ecdsa";
      const missing = [
        ["text", signatureText],
        ["signing_address", signingAddress],
        ["signature", signature],
      ].filter(([, value]) => value === undefined);
      if (missing.length > 0) {
        return bad(
          502,
          `ai upstream: signature response did not state ${missing.map(([name]) => name).join(", ")}`,
        );
      }

      const bundle: JsonObject = {
        version: 1,
        nonce,
        model,
        request_text: requestText,
        response_text: completion.responseText,
        attestation: report,
        signature: {
          chat_id: completion.chatId,
          signing_algo: signingAlgo,
          signing_address: signingAddress!,
          text: signatureText!,
          signature: signature!,
        },
      };

      const answer = RedactionAnswer.safeParse(readJson(content));
      if (answer.success) {
        return {
          ok: true,
          retryAfterMs: 0,
          result: {
            model,
            chat_id: completion.chatId,
            suggestions: answer.data.suggestions,
            residual_risks: answer.data.residual_risks,
            unparsed: null,
            bundle,
          },
        };
      }
      // A model that answered in prose still cost us the call and still produced attestable bytes, so the
      // answer and the bundle go back and the page shows the words. Refusing here would throw away the tip.
      return {
        ok: true,
        retryAfterMs: 0,
        result: {
          model,
          chat_id: completion.chatId,
          suggestions: null,
          residual_risks: [],
          unparsed: content,
          bundle,
        },
      };
    },
  };
};
