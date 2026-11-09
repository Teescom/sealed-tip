// The ONLY place that knows sealedtip method names and argument shapes (S-6.2).
//
// Reads only, and that is the design: everything that changes chain state goes through a tipster-signed
// action (`packages/crypto/src/actions.ts`) and the relayer, so this module holds no key, no signer and no
// wallet. The anonymous tipster page, the panel page and the keeper all get their chain state from here,
// which is what keeps "what the page says about a tip" and "what the chain says about a tip" the same fact.
//
// `getTipForPanel` is the one method that returns CIDs and sealed-key pointers. This module cannot decide
// who may call it — the panel session (S-6.4) does that — but it keeps the public and panel paths under
// different names so an anonymous page has to reach across deliberately.
import { JsonRpcProvider } from "near-api-js";
import { z } from "zod";

import { KeeperInfo, Programme, ProgrammeStats, Tip, TipPublic } from "./types.js";

/** `from_index` is a position in insertion order, not an id (`contracts/sealedtip/src/views.rs`). */
export const DEFAULT_PAGE = 50;

/** The contract answers a bigger `limit` by clamping it with `.min(200)` and saying nothing, so we clamp
 * the same way: a caller that asked for 500 gets the 200 rows the chain was going to send, not a short
 * page it reads as "that is all there is". */
export const MAX_PAGE = 200;

/** One sealedtip view call: method name and JSON arguments in, decoded JSON out. */
export type ViewCall = (method: string, args: Record<string, unknown>) => Promise<unknown>;

/** How far behind the head a read is allowed to be — or, with `"optimistic"`, how far ahead of finality. */
export type Finality = "optimistic" | "near-final" | "final";

export interface ViewClientOptions {
  /** Replace the transport — for tests, or for a caller that already has a provider or gateway auth. */
  readonly view?: ViewCall;
  /** Default `"final"`: an optimistic read can show a tip and then watch it disappear. */
  readonly finality?: Finality;
}

/**
 * A view call's failure, re-labeled with the method that made it. The chain's reason is kept verbatim and
 * never parsed.
 *
 * `get_programme_stats` answers an unknown programme by panicking rather than by returning an option, but
 * "does this programme exist" has a cheap, unambiguous answer two methods away — `get_programme` gives
 * `null` — so existence is read from the view that models it and a panic stays what it is: an error from the
 * node, its text in `message`, the original in `cause`. Mapping the panic string to a type here would work
 * only while a gateway formats the error the way our pattern expects; measured on mainnet RPC, a failed view
 * call comes back as HTTP 200 with the reason in `result.error`, and near-api-js 7.4.0 passes anything it
 * does not recognize straight through. That is a fine thing to show an operator and a bad thing to branch on.
 */
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Ids are `u64` in Rust, and the arguments the contract would reject are worth refusing locally: one
 * `RangeError` here beats a signed round trip to an RPC node for a serde error. */
const checkId = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
};

/**
 * Paths and complaints, never values. These are chain reads a hostile tipster can shape — an evidence CID
 * is a free-form string on chain — and a thrown message is exactly the thing that ends up in a deploy log.
 */
const describe = (issues: readonly z.ZodIssue[]): string =>
  issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");

const checked = <T>(schema: z.ZodType<T>, method: string, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${method}: the chain returned something the schema does not accept — ${describe(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

/**
 * The wire `contracts/sealedtip/tests` uses. `callFunction` only treats a `Uint8Array` as already
 * serialized — an object goes through its own guess about positional versus named arguments — so the
 * bytes are built here the way `scripts/lib/near.ts` builds them.
 *
 * One provider per client, built on first use: a page that reads three views should not open three
 * connections, and a caller that injects its own `view` should not pay for a provider it never uses.
 */
const rpcView = (rpcUrl: string, contractId: string, finality: Finality): ViewCall => {
  let provider: JsonRpcProvider | undefined;
  return async (method, args) => {
    provider ??= new JsonRpcProvider({ url: rpcUrl });
    return provider.callFunction({
      contractId,
      method,
      args: new TextEncoder().encode(JSON.stringify(args)),
      blockQuery: { finality },
    });
  };
};

export interface ViewClient {
  getProgramme(id: number): Promise<Programme | null>;
  listProgrammes(fromIndex?: number, limit?: number): Promise<Programme[]>;
  getProgrammeStats(id: number): Promise<ProgrammeStats>;
  getTipPublic(id: number): Promise<TipPublic | null>;
  getTipForPanel(id: number): Promise<Tip | null>;
  /**
   * The keeper account, its X25519 public half and its liveness. The anonymous submission page calls this:
   * a switch key sealed to a public key read from the page's own config is a switch that opens for whoever
   * the deployer wrote down, and `set_keeper` means that answer changes without the build changing.
   */
  getKeeperInfo(): Promise<KeeperInfo>;
}

export const createViewClient = (
  rpcUrl: string,
  contractId: string,
  options: ViewClientOptions = {},
): ViewClient => {
  const { finality = "final" } = options;
  const view = options.view ?? rpcView(rpcUrl, contractId, finality);

  /** Absence is `null` from the wasm and `undefined` from a provider that got zero result bytes; both mean
   * the same thing, and only the three views that return `Option<…>` are read this way. */
  const optional = <T>(schema: z.ZodType<T>, method: string, value: unknown): T | null =>
    value === null || value === undefined ? null : checked(schema, method, value);

  const invoke = async (method: string, args: Record<string, unknown>): Promise<unknown> => {
    try {
      return await view(method, args);
    } catch (error) {
      throw new Error(`${method}: ${errorText(error)}`, { cause: error });
    }
  };

  const read = async <T>(schema: z.ZodType<T>, method: string, args: Record<string, unknown>): Promise<T> =>
    checked(schema, method, await invoke(method, args));

  const readOne = async <T>(
    schema: z.ZodType<T>,
    method: string,
    args: Record<string, unknown>,
  ): Promise<T | null> => optional(schema, method, await invoke(method, args));

  return {
    async getProgramme(id) {
      checkId("programme id", id);
      return readOne(Programme, "get_programme", { programme_id: id });
    },

    async listProgrammes(fromIndex = 0, limit = DEFAULT_PAGE) {
      checkId("from_index", fromIndex);
      checkId("limit", limit);
      return read(z.array(Programme), "list_programmes", {
        from_index: fromIndex,
        limit: Math.min(limit, MAX_PAGE),
      });
    },

    async getProgrammeStats(id) {
      checkId("programme id", id);
      return read(ProgrammeStats, "get_programme_stats", { programme_id: id });
    },

    async getTipPublic(id) {
      checkId("tip id", id);
      return readOne(TipPublic, "get_tip_public", { tip_id: id });
    },

    async getTipForPanel(id) {
      checkId("tip id", id);
      return readOne(Tip, "get_tip_for_panel", { tip_id: id });
    },

    async getKeeperInfo() {
      return read(KeeperInfo, "get_keeper_info", {});
    },
  };
};
