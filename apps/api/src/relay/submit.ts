// Round-robin over the two relayer accounts' function-call keys (S-8.4).
//
// ARCHITECTURE §9 runs two relayers with separate accounts and B9 names the reason: one account is one
// point of failure that can drop every action, and the contract's allow-list (S-2.9) is what makes a
// rotation possible rather than theoretical. Alternating per action is the whole of the "load balance"
// here — there is no health check, because a relayer whose key is wrong or whose balance has run out
// fails into `onUndelivered`, and the turn still advances, so the next action tries the other account.
//
// What this module deliberately is not: a general transaction proxy. `signed.ts` holds the allow-list and
// only ever calls here with a method from it. A service that would sign any method with a key allowed to
// call every method on the contract is a worse version of the thing it relays for.

import { Account, JsonRpcProvider, KeyPairEd25519, KeyPairSigner } from "near-api-js";

export interface Relayer {
  readonly account: string;
  /** `ed25519:…` from `.env`. Used to build a signer, then dropped; never written to a log or a result. */
  readonly secretKey: string;
}

export interface SendResult {
  readonly txHash: string;
}

/** The chain side, behind an interface so the rotation and the gas arithmetic are testable without a node. */
export type SendTransaction = (
  relayer: Relayer,
  receiver: string,
  method: string,
  args: Record<string, unknown>,
  gas: bigint,
) => Promise<SendResult>;

export interface SubmitterOptions {
  /** Both, always: one relayer account would make every action depend on a single key. */
  readonly relayers: readonly [Relayer, Relayer];
  readonly contract: string;
  /** Only read by the default `send`, which is the one place that talks to a node. */
  readonly rpcUrl?: string;
  readonly send?: SendTransaction;
  readonly gas?: (method: string) => number;
}

export interface Submitter {
  submit(method: string, args: Record<string, unknown>): Promise<SendResult & { relayer: string }>;
  /** The account the next action would go out from, without consuming the turn. */
  next(): Relayer;
}

/**
 * TGas per method: the amounts the contract's own sandbox suite runs green at (`tests/common/mod.rs` —
 * 100 for `submit_tip` and `claim`, 50 for the two cheap actions). `claim` is expensive because it pays
 * out and detaches a gas drip, and `submit_tip` because it verifies a signature and writes a whole `Tip`.
 * There is deliberately no default: an unlisted method means the allow-list was bypassed.
 */
const GAS_TGAS: Record<string, number> = {
  submit_tip: 100,
  claim: 100,
  checkin: 50,
  retract: 50,
};

const TGAS = 1_000_000_000_000n;
const ED25519_PREFIX = "ed25519:";

/** The real sender, bound to one RPC endpoint. */
export const sendTransaction = (rpcUrl: string): SendTransaction => {
  const provider = new JsonRpcProvider({ url: rpcUrl });
  return async (relayer, receiver, method, args, gas) => {
    if (!relayer.secretKey.startsWith(ED25519_PREFIX)) {
      // The name of the problem only: this throw is the one message from here that can reach a log, and
      // the line before it is where a private key would have been echoed.
      throw new Error(`the key configured for ${relayer.account} is not an ed25519: key`);
    }
    const account = new Account(
      relayer.account,
      provider,
      new KeyPairSigner(new KeyPairEd25519(relayer.secretKey.slice(ED25519_PREFIX.length))),
    );
    const result = await account.callFunctionRaw({
      contractId: receiver,
      methodName: method,
      // Pre-encoded, the way `scripts/lib/near.ts` and the view client do it: JSON.stringify over the
      // named arguments is exactly what the contract expects, and handing the library an object leaves
      // the encoding to whatever its current version guesses about positional versus named arguments.
      args: new TextEncoder().encode(JSON.stringify(args)),
      gas,
      // Nothing a relayer forwards attaches a deposit: `claim`'s 1 yoctoNEAR is the contract's own
      // problem, paid from the programme's `ops_balance`, not something a caller may choose here.
      deposit: 0n,
    });
    return { txHash: result.transaction_outcome.id };
  };
};

export const createSubmitter = (options: SubmitterOptions): Submitter => {
  const [first, second] = options.relayers;
  const send =
    options.send ?? (options.rpcUrl === undefined ? undefined : sendTransaction(options.rpcUrl));
  if (send === undefined) {
    throw new Error("createSubmitter needs rpcUrl (or an injected send): refusing to guess which network to spend on");
  }
  const gasOf =
    options.gas ??
    ((method: string): number => {
      const tgas = GAS_TGAS[method];
      if (tgas === undefined) throw new Error(`no gas configured for ${method}`);
      return tgas;
    });
  let turn = 0;

  return {
    next: () => (turn % 2 === 0 ? first : second),
    submit: async (method, args) => {
      const relayer = turn % 2 === 0 ? first : second;
      const gas = BigInt(gasOf(method)) * TGAS;
      // The turn advances before the call, so a relayer that fails does not pin every later action to it.
      turn += 1;
      const result = await send(relayer, options.contract, method, args, gas);
      return { ...result, relayer: relayer.account };
    },
  };
};
