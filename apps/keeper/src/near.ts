// The keeper's only way to change the chain, and the allow-list of what it may change (S-9.1, S-9.3).
//
// `KeeperMethod` is a union rather than a `string` on purpose. ARCHITECTURE §5 gives this service two
// mutating methods — `heartbeat` and `post_released_keys` — and AGENTS.md turns that into a rule ("no
// mutating method not listed in ARCHITECTURE §5"). Encoding the list in the type means a call to anything
// else, `claim` included, is a compile error instead of a code review item: a keeper that can spend
// programme money is a worse version of the thing it watches for.
//
// The key is a function-call key scoped to those two methods on the deployed account (AGENTS.md, "never
// full-access"). This module is the only place that reads it, it hands it to `KeyPairSigner` and drops it,
// and nothing here prints it: a failed transaction's error text is the one string from here that reaches a
// log.
import { Account, JsonRpcProvider, KeyPairEd25519, KeyPairSigner } from "near-api-js";

export const KEEPER_METHODS = ["heartbeat", "post_released_keys"] as const;

export type KeeperMethod = (typeof KEEPER_METHODS)[number];

export type KeeperCall = (method: KeeperMethod, args: Record<string, unknown>) => Promise<{ txHash: string }>;

/**
 * 100 TGAS for both, because that is what the contract's own sandbox suite runs them green at
 * (`contracts/sealedtip/tests/common/mod.rs` `call_with_deposit`, which is how `tests/switch.rs` calls
 * `heartbeat` and `post_released_keys`). Deliberately no default: an unlisted method would have to be a
 * type error first, and a gas table with a fallback is how a fallback becomes normal.
 */
const GAS_TGAS: Record<KeeperMethod, number> = {
  heartbeat: 100,
  post_released_keys: 100,
};

const TGAS = 1_000_000_000_000n;
const ED25519_PREFIX = "ed25519:";

export interface KeeperCallOptions {
  readonly account: string;
  /** `ed25519:…`, as `KEEPER_KEY` is validated to be by `env.ts`. Used, then dropped. */
  readonly secretKey: string;
  readonly rpcUrl: string;
  readonly contract: string;
}

/**
 * The real transport. Arguments are pre-encoded the way `scripts/lib/near.ts`, the view client and the
 * relayer all do it: `JSON.stringify` over the named arguments is exactly what the contract expects, and
 * handing the SDK an object leaves the encoding to whatever its current version guesses about positional
 * versus named arguments.
 */
export const keeperCall = (options: KeeperCallOptions): KeeperCall => {
  const provider = new JsonRpcProvider({ url: options.rpcUrl });
  let account: Account | undefined;
  const open = (): Account =>
    (account ??= new Account(
      options.account,
      provider,
      new KeyPairSigner(new KeyPairEd25519(options.secretKey.slice(ED25519_PREFIX.length))),
    ));

  return async (method, args) => {
    const result = await open().callFunctionRaw({
      contractId: options.contract,
      methodName: method,
      args: new TextEncoder().encode(JSON.stringify(args)),
      gas: BigInt(GAS_TGAS[method]) * TGAS,
      // Neither keeper method takes a deposit: `heartbeat` records a timestamp and
      // `post_released_keys` writes pointers to ciphertext. A deposit here would be a third behaviour.
      deposit: 0n,
    });
    return { txHash: result.transaction_outcome.id };
  };
};
