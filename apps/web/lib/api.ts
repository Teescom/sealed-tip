// The tip API as the browser sees it: blobs, relayed actions, the AI step (S-8.3, S-8.4, S-8.5, S-10.4).
//
// Three calls, one module, because these are the only three servers a tipster's page is allowed to talk to
// and the CSP is what makes that true (`next.config.ts` puts this origin, the API and the RPC in
// `connect-src` and nothing else). Keeping them together is also the cheapest way to make the privacy story
// reviewable: everything that leaves the browser is in this file, and none of it is plaintext except the one
// passage the tipster chose to send for analysis.
//
// Errors come back as values rather than thrown, for a specific reason: every server error this page can
// receive is a sentence written to be shown (`relay.ts` refuses with a rule, `blob.ts` with a byte count), and
// a flow that renders them is a flow that must not swallow one. The caller decides between "tell the tipster"
// and "stop", and the type makes them say which.
import { z } from "zod";

import { BUNDLE_MAX_BYTES } from "@sealedtip/core";

/** The four actions a relayer will spend gas for — the same list `apps/api/src/relay/gate.ts` admits. */
export const RELAY_ACTIONS = ["submit_tip", "checkin", "retract", "claim"] as const;
export type RelayAction = (typeof RELAY_ACTIONS)[number];

const ErrorBody = z.object({ error: z.string() });

/** `POST /blob` answers with the CID it computed and the size it accepted. */
const PutBlobBody = z.object({ cid: z.string(), bytes: z.number().int().nonnegative() });

/** `POST /relay/:action` answers 202 with when the action is expected on chain, in wall-clock ms. */
const QueuedBody = z.object({ queuedUntil: z.number().int().nonnegative() });

export type ApiOk<T> = { readonly ok: true; readonly value: T };
export type ApiError = { readonly ok: false; readonly status: number; readonly error: string };
export type ApiResult<T> = ApiOk<T> | ApiError;

export interface TipApiDeps {
  readonly fetch?: typeof fetch;
}

export interface TipApi {
  /** Uploads ciphertext and returns the CID the store recorded. The caller has already encrypted it. */
  putBlob(bytes: Uint8Array): Promise<ApiResult<{ cid: string; bytes: number }>>;
  /** Ciphertext by CID; `null` is a real answer and not an error. */
  getBlob(cid: string): Promise<ApiResult<Uint8Array | null>>;
  /** Hands a signed action to the relayer queue and reports when it expects to have sent it. */
  relay(action: RelayAction, args: Record<string, unknown>): Promise<ApiResult<{ queuedUntil: number }>>;
  /** The optional AI step: the passage the tipster selected, and nothing else. */
  redact(body: { text: string; nonce: string; model?: string }): Promise<ApiResult<unknown>>;
}

const origin = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

/** The server's own sentence when it sent one; the status when it did not. */
const messageFor = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => "");
  try {
    const parsed = ErrorBody.safeParse(JSON.parse(text) as unknown);
    if (parsed.success) return parsed.data.error;
  } catch {
    // Not JSON, which is what the fallback says.
  }
  return `HTTP ${response.status}`;
};

export const createTipApi = (baseUrl: string, deps: TipApiDeps = {}): TipApi => {
  const fetchFn = deps.fetch ?? fetch;
  const base = origin(baseUrl);

  const fail = async (response: Response): Promise<ApiError> => ({
    ok: false,
    status: response.status,
    error: await messageFor(response),
  });

  const json = async <T>(schema: z.ZodType<T>, response: Response): Promise<ApiResult<T>> => {
    if (!response.ok) return await fail(response);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, status: 502, error: `the API answered ${response.status} with something that is not JSON` };
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success) {
      return { ok: false, status: 502, error: `the API answered something unexpected: ${checked.error.issues.map((issue) => issue.message).join(", ")}` };
    }
    return { ok: true, value: checked.data };
  };

  return {
    async putBlob(bytes) {
      if (bytes.byteLength === 0) return { ok: false, status: 400, error: "refusing to upload an empty blob" };
      // Checked here as well as at the store because the store's cap is on ciphertext and this one is about
      // the tipster's own expectation: a 30 MB bundle should be refused before the upload, not after it.
      if (bytes.byteLength > BUNDLE_MAX_BYTES) {
        return { ok: false, status: 413, error: `the bundle is ${bytes.byteLength} bytes, over the ${BUNDLE_MAX_BYTES} byte cap` };
      }
      const response = await fetchFn(`${base}/blob`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: Uint8Array.from(bytes) as unknown as BodyInit,
      });
      return await json(PutBlobBody, response);
    },

    async getBlob(cid) {
      const response = await fetchFn(`${base}/blob/${encodeURIComponent(cid)}`);
      if (response.status === 404) return { ok: true, value: null };
      if (!response.ok) return await fail(response);
      return { ok: true, value: new Uint8Array(await response.arrayBuffer()) };
    },

    async relay(action, args) {
      const body = JSON.stringify(args);
      const response = await fetchFn(`${base}/relay/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body });
      return await json(QueuedBody, response);
    },

    async redact(body) {
      const response = await fetchFn(`${base}/ai/redact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) return await fail(response);
      const text = await response.text();
      try {
        return { ok: true, value: JSON.parse(text) as unknown };
      } catch {
        return { ok: false, status: 502, error: "the AI proxy answered with something that is not JSON" };
      }
    },
  };
};
