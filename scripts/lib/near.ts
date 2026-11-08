// The thin end of the scripts: one provider, one signer per account, and the arithmetic a deploy
// needs. Keys come from .env first and the near-cli keychain second, and a secret is used to build a
// signer then dropped — printing one is how a private key ends up in a terminal recording.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Account, JsonRpcProvider, KeyPairEd25519, KeyPairSigner } from "near-api-js";

/** An account with no code reports this, and it is also base58 of 32 zero bytes. */
export const EMPTY_CODE_HASH = "11111111111111111111111111111111";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_PREFIX = "ed25519:";

/** NEAR's base58 is Bitcoin's alphabet, and the chain's code hashes are base58 of a sha256 digest. */
export const base58 = (bytes: Uint8Array): string => {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let digits = "";
  while (value > 0n) {
    digits = BASE58.charAt(Number(value % 58n)) + digits;
    value /= 58n;
  }
  const firstNonZero = bytes.findIndex((byte) => byte !== 0);
  const leadingZeroes = firstNonZero === -1 ? bytes.length : firstNonZero;
  return `${"1".repeat(leadingZeroes)}${digits}`;
};

/** The same identifier the RPC reports for deployed code, so a local build can be matched to chain state. */
export const codeHashOf = (wasm: Uint8Array): string =>
  base58(new Uint8Array(createHash("sha256").update(wasm).digest()));

export interface Net {
  readonly provider: JsonRpcProvider;
  readonly network: string;
  readonly rpcUrl: string;
  readonly explorer: string;
  /** yoctoNEAR per byte of storage — the price a wasm is paid in. */
  storageCostPerByte(): Promise<bigint>;
}

export const openNet = async (rpcUrl: string): Promise<Net> => {
  const provider = new JsonRpcProvider({ url: rpcUrl });
  // .env said testnet; this is the second opinion, taken from the node we are about to spend on.
  const network = await provider.getNetworkId();
  if (network !== "testnet") {
    throw new Error(`refusing to run: ${rpcUrl} serves "${network}" and these scripts are testnet-only (AGENTS.md)`);
  }
  let perByte: bigint | undefined;
  return {
    provider,
    network,
    rpcUrl,
    explorer: "https://testnet.explorer.near.org",
    storageCostPerByte: async () => {
      if (perByte === undefined) {
        const config = await provider.experimental_protocolConfig({ finality: "final" });
        const reported = config.runtime_config?.storage_amount_per_byte;
        // A number here would be a float past 2^53, and a storage price read through a float is a
        // deposit that can come out one byte short.
        if (typeof reported !== "string") {
          throw new Error(`protocol config reported storage_amount_per_byte as ${typeof reported}, not a yocto string`);
        }
        perByte = BigInt(reported);
      }
      return perByte;
    },
  };
};

export interface KeySource {
  /** .env var holding the `ed25519:…` secret, when this deployment keeps one there. */
  readonly envVar?: string;
  readonly account: string;
}

const keychainFile = (network: string, account: string): string =>
  join(homedir(), ".near-credentials", network, `${account}.json`);

const keyPair = (encoded: string, account: string): KeyPairEd25519 => {
  if (!encoded.startsWith(ED25519_PREFIX)) {
    throw new Error(`the key for ${account} is not an ed25519: key`);
  }
  return new KeyPairEd25519(encoded.slice(ED25519_PREFIX.length));
};

/**
 * An env var wins, else the near-cli keychain file. For the relayers and the keeper that file holds
 * the function-call key S-0.9 installed rather than the full-access one, so a service key stays scoped.
 */
export const signerFor = (env: Record<string, string | undefined>, net: Net, source: KeySource): KeyPairSigner => {
  const fromEnv = source.envVar === undefined ? undefined : env[source.envVar];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return new KeyPairSigner(keyPair(fromEnv, source.account));
  }
  const path = keychainFile(net.network, source.account);
  if (!existsSync(path)) {
    throw new Error(`no key for ${source.account}: set ${source.envVar ?? "its key"} in .env or create ${path}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const encoded = (parsed as { private_key?: unknown }).private_key;
  if (typeof encoded !== "string" || encoded.length === 0) throw new Error(`${path} carries no private_key`);
  return new KeyPairSigner(keyPair(encoded, source.account));
};

export const openAccount = (
  net: Net,
  account: string,
  env: Record<string, string | undefined>,
  source: KeySource,
): Account => new Account(account, net.provider, signerFor(env, net, source));

/**
 * What the key we are about to sign with is allowed to do. Deploying code needs a full-access key,
 * and S-0.9 deliberately swapped the service accounts' keychain entries over to scoped function-call
 * keys — so a script that silently picked one up must say so rather than fail with a chain error.
 */
export const keyPermission = async (
  net: Net,
  env: Record<string, string | undefined>,
  source: KeySource,
): Promise<{ fullAccess: boolean; summary: string }> => {
  const publicKey = await signerFor(env, net, source).getPublicKey();
  const key = await net.provider.viewAccessKey({ accountId: source.account, publicKey });
  const permission = key.permission;
  if (permission === "FullAccess") return { fullAccess: true, summary: "FullAccess" };
  if ("GasKeyFullAccess" in permission) return { fullAccess: true, summary: "GasKeyFullAccess" };
  const call = "FunctionCall" in permission ? permission.FunctionCall : permission.GasKeyFunctionCall;
  return {
    fullAccess: false,
    summary: `FunctionCall on ${call.receiver_id} (${call.method_names.join(", ") || "any method"})`,
  };
};

/** Every read in these scripts is of final state, so a re-run cannot plan against a forked view. */
const FINALITY = { finality: "final" } as const;

export interface ChainInfo {
  readonly account: string;
  readonly codeHash: string;
  readonly codeBytes: number;
  readonly storageUsage: number;
  readonly balance: bigint;
}

/** Reads the deployed wasm as well: its length is what a re-deploy adds to the account's storage bill. */
export const chainInfo = async (net: Net, account: string): Promise<ChainInfo> => {
  const state = await net.provider.viewAccount({ accountId: account, blockQuery: FINALITY });
  // An account with no code answers this with empty bytes; some builds throw instead. Both mean zero.
  const code = await net.provider
    .viewContractCode({ contractId: account, blockQuery: FINALITY })
    .catch(() => undefined);
  return {
    account,
    codeHash: state.code_hash,
    codeBytes: code === undefined ? 0 : code.code.length,
    storageUsage: state.storage_usage,
    balance: state.amount,
  };
};

/**
 * Sending a transaction as `account`, which signs with its own key. Every method here is a plain
 * function call, so a scoped function-call key is enough — only code deployment and account creation
 * need the FullAccess key, and those are the script's own decisions, not this helper's.
 */
export const transact = async (
  net: Net,
  env: Record<string, string | undefined>,
  source: KeySource,
  receiver: string,
  method: string,
  args: Record<string, unknown>,
  gas: bigint,
  deposit: bigint = 0n,
): Promise<string> => {
  const result = await openAccount(net, source.account, env, source).callFunctionRaw({
    contractId: receiver,
    methodName: method,
    args,
    gas,
    deposit,
  });
  return transactionHash(result);
};

/**
 * A plain NEAR transfer, which is what tops an account up so it can pay for its own gas and bonds.
 * Checked against the key first: S-0.9 deliberately left the service accounts holding scoped
 * function-call keys, and one of those cannot sign a transfer at all.
 */
export const transferNear = async (
  net: Net,
  env: Record<string, string | undefined>,
  source: KeySource,
  receiver: string,
  amount: bigint,
): Promise<string> => {
  const permission = await keyPermission(net, env, source);
  if (!permission.fullAccess) {
    throw new Error(
      `${source.account} cannot top up ${receiver}: its ${permission.summary} key is not allowed to send NEAR`,
    );
  }
  const result = await openAccount(net, source.account, env, source).transfer({
    receiverId: receiver,
    amount,
  });
  return transactionHash(result);
};

/** Only the "not there" answer is read as absence; a network error must not look like an empty account. */
export const accountExists = async (net: Net, account: string): Promise<boolean> => {
  try {
    await net.provider.viewAccount({ accountId: account, blockQuery: FINALITY });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist|unknown account/i.test(message)) return false;
    throw new Error(`could not read ${account}: ${message}`);
  }
};

export const hasCode = (info: ChainInfo): boolean => info.codeHash !== EMPTY_CODE_HASH;

export const transactionHash = (result: { transaction_outcome: { id: string } }): string =>
  result.transaction_outcome.id;

/**
 * A view call. The args go over the wire as JSON bytes rather than as an object, because the provider
 * only treats a `Uint8Array` as "already serialized" — an object is run through its own guess about
 * positional versus named arguments.
 */
export const view = async (net: Net, contract: string, method: string, args: object = {}): Promise<unknown> =>
  net.provider.callFunction({
    contractId: contract,
    method,
    args: new TextEncoder().encode(JSON.stringify(args)),
  });

export const accountUrl = (net: Net, account: string): string => `${net.explorer}/accounts/${account}`;
export const transactionUrl = (net: Net, hash: string): string => `${net.explorer}/transactions/${hash}`;
