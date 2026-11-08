// What a deploy run is going to do, computed before any of it happens (S-7.1). No RPC here, so the
// idempotency rule — the thing that makes a second run a no-op instead of a duplicate deployment —
// is a function with a test rather than a comment in a script.
import { join } from "node:path";

import { optionalVar, requireVar, type EnvMap } from "./env.js";
import { near } from "./units.js";

export interface LocalCode {
  readonly codeHash: string;
  readonly bytes: number;
}

export interface OnChainCode {
  readonly codeHash: string;
  readonly codeBytes: number;
  readonly storageUsage: number;
  readonly balance: bigint;
}

export type CodeAction = "deploy" | "up-to-date";
export type InitAction = "init" | "init-after-deploy" | "already-initialised";

export interface TargetPlan {
  readonly account: string;
  readonly codeAction: CodeAction;
  readonly initAction: InitAction;
  /** NEAR to move in first so the account can pay for the new wasm's storage. Zero when it already can. */
  readonly topUp: bigint;
  readonly requiredBalance: bigint;
}

export interface PlanInput {
  readonly account: string;
  readonly chain: OnChainCode;
  readonly local: LocalCode;
  /** Whether a view call is answered. False for an account with no code, which cannot answer one yet. */
  readonly initialized: boolean;
  readonly storageCostPerByte: bigint;
  /** Headroom left on the account above its storage bill, because storage staking is not a gas budget. */
  readonly buffer: bigint;
}

export const planTarget = (input: PlanInput): TargetPlan => {
  const { account, chain, local, initialized, storageCostPerByte: perByte, buffer } = input;
  const codeAction: CodeAction = chain.codeHash === local.codeHash ? "up-to-date" : "deploy";
  const initAction: InitAction = initialized
    ? "already-initialised"
    : codeAction === "deploy"
      ? "init-after-deploy"
      : "init";
  const usageAfter =
    codeAction === "up-to-date" ? chain.storageUsage : chain.storageUsage - chain.codeBytes + local.bytes;
  if (usageAfter < 0) {
    throw new RangeError(`${account} reports ${chain.storageUsage} bytes of storage with ${chain.codeBytes} bytes of code`);
  }
  // Deploying replaces the old wasm, so only the size difference is new storage. An account with no
  // code reports the empty hash and zero code bytes, which makes the same arithmetic cover a first deploy.
  const requiredBalance = BigInt(usageAfter) * perByte + buffer;
  const shortfall = codeAction === "up-to-date" ? 0n : requiredBalance - chain.balance;
  return {
    account,
    codeAction,
    initAction,
    topUp: shortfall > 0n ? shortfall : 0n,
    requiredBalance,
  };
};

export interface InitCall {
  readonly method: string;
  /** near-sdk reads named JSON arguments, so this is the object it deserialises, key for key. */
  readonly args: Record<string, unknown>;
  readonly gas: bigint;
}

export interface Target {
  readonly label: string;
  readonly account: string;
  readonly wasm: string;
  /** A view the contract only answers once it has been initialised. */
  readonly probe: string;
  readonly initArgs: (keeperX25519Pub: Uint8Array) => InitCall;
}

export interface DeployConfig {
  readonly deployer: string;
  readonly owner: string;
  readonly ownerIsDefault: boolean;
  readonly relayers: string[];
  readonly keeper: string;
  readonly buffer: bigint;
}

export interface DeployPlan {
  readonly config: DeployConfig;
  readonly targets: Target[];
}

/** The `new` arguments of `contracts/sealedtip/src/lib.rs`, in that file's own JSON names.
 * A type alias rather than an interface because it is handed to the SDK as a JSON object. */
export type SealedtipInit = {
  readonly owner: string;
  readonly relayers: string[];
  readonly keeper: string;
  readonly keeper_x25519_pub: number[];
};

export const sealedtipInitArgs = (input: {
  owner: string;
  relayers: string[];
  keeperAccount: string;
  keeperX25519Pub: Uint8Array;
}): SealedtipInit => {
  const { owner, relayers, keeperAccount, keeperX25519Pub } = input;
  // Two distinct relayers is the privacy claim: one of them must not be able to reorder or drop a
  // submission alone, and a duplicated name would let the same operator fill both slots.
  if (relayers.length < 2 || new Set(relayers).size !== relayers.length) {
    throw new RangeError(`sealedtip needs at least 2 distinct relayers, got ${relayers.join(", ") || "none"}`);
  }
  if (keeperX25519Pub.length !== 32) {
    throw new RangeError(`keeper X25519 public key must be 32 bytes, got ${keeperX25519Pub.length}`);
  }
  return { owner, relayers, keeper: keeperAccount, keeper_x25519_pub: Array.from(keeperX25519Pub) };
};

const INIT_GAS = 150_000_000_000_000n;

/** Storage staking is not a gas budget, so this is the headroom left on an account above its bill.
 * `seed.ts` reads the same number for the DAO deposit rather than inventing its own. */
export const deployBuffer = (env: EnvMap): bigint =>
  near(optionalVar(env, "DEPLOY_BUFFER_NEAR", "0.5"));

/**
 * Order matters: the token first, because `sealedtip`'s claim path calls into it and a programme can
 * only be funded with a token that already exists.
 */
export const deployPlan = (env: EnvMap, root: string): DeployPlan => {
  const deployer = requireVar(env, "DEPLOYER_ACCOUNT");
  const owner = optionalVar(env, "OWNER_ACCOUNT", deployer);
  const relayers = [requireVar(env, "RELAYER_A_ACCOUNT"), requireVar(env, "RELAYER_B_ACCOUNT")];
  const keeper = requireVar(env, "KEEPER_ACCOUNT");
  return {
    config: {
      deployer,
      owner,
      ownerIsDefault: owner === deployer,
      relayers,
      keeper,
      buffer: deployBuffer(env),
    },
    targets: [
      {
        label: "mock-ft",
        account: requireVar(env, "TOKEN_CONTRACT"),
        wasm: join(root, "target", "near", "mock_ft", "mock_ft.wasm"),
        probe: "ft_metadata",
        initArgs: () => ({ method: "new", args: {}, gas: INIT_GAS }),
      },
      {
        label: "sealedtip",
        account: requireVar(env, "SEALEDTIP_CONTRACT"),
        wasm: join(root, "target", "near", "sealedtip", "sealedtip.wasm"),
        probe: "list_programmes",
        initArgs: (keeperX25519Pub) => ({
          method: "new",
          args: sealedtipInitArgs({ owner, relayers, keeperAccount: keeper, keeperX25519Pub }),
          gas: INIT_GAS,
        }),
      },
    ],
  };
};
