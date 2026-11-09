// The relay allow-list: which actions this service will spend a relayer transaction for, and what it
// checks before spending (S-8.4).
//
// Two rules shape this file.
//
// The first is that a tip API holding two allow-listed relayer keys must not become a general
// transaction proxy. So the list is four methods, and anything else — a `set_relayers`, a `triage`, an
// `ft_transfer` — is refused here rather than reaching a chain.
//
// The second is what this service does *not* check, and it is the more important half. The signature is
// not verified here: `project_structure.md` §5 forbids `apps/api` from importing `packages/crypto`
// ("the server never handles keys or plaintext"), ESSENTIALS #15 puts verification in
// `env::ed25519_verify`, and a second implementation of the signed-message format in TypeScript is the
// kind of copy that goes stale the week `SignedAction` changes. What is checked is the shape (zod, from
// `@sealedtip/core`, which describes the same wasm) and existence, and the reason both are here is
// money: each is a free way to avoid paying gas for a transaction the contract would refuse.
//
// The cost of that choice, stated rather than hidden: a well-formed call with a bad signature still costs
// one relayer transaction that fails on chain. That is what the shared token bucket in `ratelimit.ts`
// bounds — the per-key bucket cannot be the defence, because a claim pubkey is something a caller either
// supplies or can read off the tip, so it is fairness against a misbehaving page and nothing more.
// Status and balance rules are not duplicated here either: the contract owns those answers and enforces
// them in its own cheapest-first order (S-5.1).

import { z } from "zod";

import { AccountId, Bytes32, Cid, Payout, SealedKey, U64, type Tip } from "@sealedtip/core";

/** The methods a relayer is allowed to forward. `trigger` is absent: it needs no relayer and no signature. */
export const RELAY_METHODS = ["submit_tip", "checkin", "retract", "claim"] as const;
export type RelayMethod = (typeof RELAY_METHODS)[number];

export const isRelayMethod = (method: string): method is RelayMethod =>
  (RELAY_METHODS as readonly string[]).includes(method);

/**
 * A signature is 64 bytes; base64 of that is 86–88 characters of a fixed alphabet. `Buffer.from` is
 * forgiving about what it is handed, so the charset is checked before the length — otherwise a body of
 * `....` decodes to something, and the only honest answer about it is the chain's.
 */
const Signature = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64")
  .refine((s) => Buffer.from(s, "base64").length === 64, "64 bytes");

/** A bare `u64` in these arguments is a JSON number, which is what the deployed wasm writes (S-6.1). */
const Num = z.number().int().nonnegative();

/** `SwitchInput` in `types.rs`: what the tipster arms, before the contract scales it. */
const SwitchInput = z.object({
  interval: U64,
  grace: U64,
  bundle_key_for_keeper: Cid,
  includes_raw: z.boolean(),
});

const SubmitArgs = z.object({
  programme_id: Num,
  claim_pubkey: Bytes32,
  evidence_cid: Cid,
  evidence_hash: Bytes32,
  sealed_keys: z.array(SealedKey),
  recused: z.array(AccountId),
  cleaning_report_hash: Bytes32,
  attestation_hash: Bytes32.nullable(),
  switch: SwitchInput.nullable(),
  pow_nonce: Num,
  signature: Signature,
});

const ActionArgs = z.object({ tip_id: Num, nonce: Num, signature: Signature });
const ClaimArgs = ActionArgs.extend({ payout: Payout });

/** Everything the route needs after a request has been proved to be shaped like someone's own action. */
export interface Ticket {
  readonly method: RelayMethod;
  /** The contract's own arguments, validated and ready to serialize. */
  readonly args: Record<string, unknown>;
  /**
   * The claim pubkey this action is attributed to, hex — the per-key rate-limit identity, and never an
   * address. Supplied by the caller for a submission, read off the tip for an action.
   */
  readonly key: string;
}

/** The statuses a refusal here can mean. A literal union, so the route hands one to Hono unwrapped. */
export type RejectStatus = 400 | 404 | 413 | 429 | 502;

export type Verdict =
  | { readonly ok: true; readonly ticket: Ticket }
  | { readonly ok: false; readonly status: RejectStatus; readonly error: string };

export interface RelayContext {
  readonly contract: string;
  /**
   * The tip as the chain has it. `get_tip_for_panel` is the view that answers `null` for a tip that does
   * not exist, and reading it changes nothing about who can see what: every field it returns is either
   * already public or ciphertext.
   */
  readonly tipReader: (tipId: number) => Promise<Tip | null>;
}

const refuse = (status: RejectStatus, error: string): Verdict => ({ ok: false, status, error });

/** Paths and complaints, never values: a validation message is the one thing that ends up in a log. */
const describe = (issues: readonly z.ZodIssue[]): string =>
  issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join(", ");

const hex = (bytes: readonly number[]): string => Buffer.from(Uint8Array.from(bytes)).toString("hex");

/**
 * Decide whether this service should spend on a request.
 *
 * The order is the cost order: a schema refusal is free, a chain read is cheap, and the gas is last.
 */
export const admit = async (ctx: RelayContext, method: RelayMethod, body: unknown): Promise<Verdict> => {
  const schema = method === "submit_tip" ? SubmitArgs : method === "claim" ? ClaimArgs : ActionArgs;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return refuse(400, `${method}: ${describe(parsed.error.issues)}`);

  if (method === "submit_tip") {
    const submit = parsed.data as z.infer<typeof SubmitArgs>;
    // There is nothing to read for a tip that does not exist yet, and nothing this service is allowed to
    // prove. Every submission rule — the PoW difficulty, the ≥2 sealed keys, a key sealed to a recused
    // member, an open programme — is the contract's and is checked there in cheapest-first order, because
    // a copy of one of those numbers in TypeScript is a value that goes stale while the wasm keeps
    // enforcing the real one.
    return { ok: true, ticket: { method, args: submit, key: hex(submit.claim_pubkey) } };
  }

  const { tip_id } = parsed.data as z.infer<typeof ActionArgs>;
  let tip: Tip | null;
  try {
    tip = await ctx.tipReader(tip_id);
  } catch (error) {
    // A node we cannot reach is not "no such tip": the first is our outage, the second is their problem.
    return refuse(502, `could not read tip ${tip_id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (tip === null) {
    // Read at `final`, so a tip that landed seconds ago can answer absent. The action is not consumed by
    // a refusal, and the tipster's page retries; the contract's per-tip nonce means a re-send of an
    // action that did land is refused rather than paid twice.
    return refuse(404, `no tip ${tip_id} on ${ctx.contract}`);
  }

  return { ok: true, ticket: { method, args: parsed.data as Record<string, unknown>, key: hex(tip.claim_pubkey) } };
};
