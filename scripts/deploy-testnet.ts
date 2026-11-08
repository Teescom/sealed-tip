// S-7.1 — put mock-ft and sealedtip on testnet, idempotently.
//
//   pnpm deploy:testnet              read the chain, print the plan, spend nothing
//   pnpm deploy:testnet -- --apply   run it
//
// The split is deliberate: this is the first code in the repository that touches a shared network,
// so a bare `pnpm deploy:testnet` must not be able to move funds by accident (AGENTS.md).
// Re-running after a successful run is a no-op: the code on each account is compared to the local
// build by code hash, and a code hash is sha256 of the bytes, so an unchanged build deploys nothing,
// tops nothing up and cannot initialise a contract that is already initialised.
import { existsSync, readFileSync } from "node:fs";

import { deployPlan, planTarget, type DeployConfig, type OnChainCode, type Target, type TargetPlan } from "./lib/deploy.js";
import { assertTestnet, loadEnv, requireVar, saveEnv, workspaceRoot, type EnvMap } from "./lib/env.js";
import { ensureX25519, toHex } from "./lib/keys.js";
import { fail } from "./lib/log.js";
import {
  EMPTY_CODE_HASH,
  accountUrl,
  chainInfo,
  codeHashOf,
  hasCode,
  keyPermission,
  openAccount,
  openNet,
  transactionHash,
  transactionUrl,
  transferNear,
  view,
  type Net,
} from "./lib/near.js";
import { formatNear } from "./lib/units.js";

const APPLY = process.argv.includes("--apply");

interface Entry {
  readonly target: Target;
  readonly chain: OnChainCode;
  readonly wasmBytes: Uint8Array;
  readonly localHash: string;
  readonly initialized: boolean;
  readonly plan: TargetPlan;
}

/** Everything a step needs that is the same for every target. */
interface Run {
  readonly net: Net;
  readonly env: EnvMap;
  readonly config: DeployConfig;
  readonly keeperPub: Uint8Array;
}

/** A deployed contract that will not answer its own documented view is not "uninitialised", it is a
 * broken run, so only near-sdk's own two panic texts are read as a missing `init`. */
const isInitialized = async (net: Net, account: string, probe: string): Promise<boolean> => {
  try {
    await view(net, account, probe);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/is not initialized|state is missing/i.test(message)) return false;
    throw new Error(`${account}.${probe}() failed for a reason this script must not guess at:\n${message}`);
  }
};

const readWasm = (target: Target): Uint8Array => {
  if (!existsSync(target.wasm)) fail(`${target.wasm} is missing — run pnpm build:contract first`);
  return new Uint8Array(readFileSync(target.wasm));
};

const describeCode = (chain: OnChainCode, localHash: string): string =>
  chain.codeHash === localHash
    ? "matches this build"
    : chain.codeHash === EMPTY_CODE_HASH
      ? "no code yet"
      : `differs from this build (${chain.codeHash})`;

/** Storage staking is paid out of the receiving account's own balance, so the deployer tops each
 * contract account up first. That is a plain transfer, which needs a FullAccess key. */
const topUp = async (run: Run, account: string, amount: bigint): Promise<void> => {
  const source = { account: run.config.deployer, envVar: "DEPLOYER_PRIVATE_KEY" };
  const hash = await transferNear(run.net, run.env, source, account, amount);
  console.log(`  + ${formatNear(amount)} NEAR from ${source.account}  ${transactionUrl(run.net, hash)}`);
};

/** The account signs for itself: its keychain entry is the FullAccess key S-0.9 created for it, not
 * the scoped function-call key the services use. */
const signerForAccount = (run: Run, account: string) => openAccount(run.net, account, run.env, { account });

const deployCode = async (run: Run, entry: Entry): Promise<void> => {
  const account = entry.target.account;
  const permission = await keyPermission(run.net, run.env, { account });
  if (!permission.fullAccess) {
    fail(`${account} key is ${permission.summary}; deploying wasm needs the FullAccess key in ~/.near-credentials/${run.net.network}/`);
  }
  await signerForAccount(run, account).deployContract(entry.wasmBytes);
  console.log(`  deployed ${entry.wasmBytes.length} bytes, sha256 ${entry.localHash}`);
};

const initialise = async (run: Run, entry: Entry): Promise<void> => {
  const init = entry.target.initArgs(run.keeperPub);
  // `callFunction` returns the parsed result and swallows the outcome; the raw one is what lets this
  // script print a link to the transaction that changed the chain.
  const result = await signerForAccount(run, entry.target.account).callFunctionRaw({
    contractId: entry.target.account,
    methodName: init.method,
    args: init.args,
    gas: init.gas,
  });
  console.log(`  called ${init.method}()  ${transactionUrl(run.net, transactionHash(result))}`);
};

const printPlan = (run: Run, envPath: string, entries: Entry[], keeperGenerated: boolean, perByte: bigint): void => {
  console.log(`network   ${run.net.network} — ${run.net.rpcUrl}`);
  console.log(`env       ${envPath}`);
  console.log(`owner     ${run.config.owner}${run.config.ownerIsDefault ? "  (= DEPLOYER_ACCOUNT; set OWNER_ACCOUNT to change)" : ""}`);
  console.log(`relayers  ${run.config.relayers.join(", ")}`);
  // A dry run makes a throwaway key and writes nothing, so the public half it prints must not be read
  // as the one the contract will be initialised with — only an applied run keeps it, in `.env`.
  const keeper = keeperGenerated
    ? APPLY
      ? `created by this run, stored in .env: ${toHex(run.keeperPub)}`
      : `none stored yet; this run would make one (a dry run's copy is throwaway)`
    : toHex(run.keeperPub);
  console.log(`keeper    ${run.config.keeper} — x25519 ${keeper}`);
  console.log(`storage   ${formatNear(perByte)} NEAR/byte + ${formatNear(run.config.buffer)} headroom`);

  for (const { target, chain, localHash, plan } of entries) {
    console.log(
      [
        `${target.label.padEnd(10)}${target.account}`,
        `  code     ${describeCode(chain, localHash)} — ${plan.codeAction}`,
        `  state    ${plan.initAction}`,
        `  balance  ${formatNear(chain.balance)} of ${formatNear(plan.requiredBalance)} NEAR${plan.topUp > 0n ? `, top up ${formatNear(plan.topUp)}` : ""}`,
      ].join("\n"),
    );
  }

  const spend = entries.reduce((total, { plan }) => total + plan.topUp, 0n);
  console.log(`\ntotal to move: ${formatNear(spend)} NEAR`);
};

const main = async (): Promise<void> => {
  const { path: envPath, env } = loadEnv();
  assertTestnet(requireVar(env, "NEAR_NETWORK"));
  const net = await openNet(requireVar(env, "NEAR_RPC_URL"));
  const { config, targets } = deployPlan(env, workspaceRoot());
  const perByte = await net.storageCostPerByte();

  // The keeper's X25519 key is the contract's only handle on the service that releases switch
  // bundles, so the first run makes one and keeps it: a fresh key per run would strand every tip
  // already sealed to the previous public half.
  const keeperKey = await ensureX25519(env, "KEEPER_X25519_SECRET");
  const run: Run = { net, env, config, keeperPub: keeperKey.publicKey };

  const entries: Entry[] = [];
  for (const target of targets) {
    const wasmBytes = readWasm(target);
    const localHash = codeHashOf(wasmBytes);
    const chain = await chainInfo(net, target.account);
    const initialized = hasCode(chain) ? await isInitialized(net, target.account, target.probe) : false;
    entries.push({
      target,
      chain,
      wasmBytes,
      localHash,
      initialized,
      plan: planTarget({
        account: target.account,
        chain,
        local: { codeHash: localHash, bytes: wasmBytes.length },
        initialized,
        storageCostPerByte: perByte,
        buffer: config.buffer,
      }),
    });
  }

  printPlan(run, envPath, entries, keeperKey.generated, perByte);

  if (!APPLY) {
    console.log("\ndry run: nothing was sent.");
    console.log("apply with: pnpm deploy:testnet -- --apply");
    return;
  }

  if (keeperKey.generated) {
    saveEnv(envPath, { KEEPER_X25519_SECRET: toHex(keeperKey.secret) });
    console.log(`\nstored a new keeper X25519 secret in ${envPath} (0600, gitignored).`);
  }

  for (const entry of entries) {
    console.log(`\n${entry.target.label}  ${entry.target.account}`);
    if (entry.plan.topUp > 0n) await topUp(run, entry.target.account, entry.plan.topUp);
    if (entry.plan.codeAction === "deploy") await deployCode(run, entry);
    else console.log("  code already matches this build — nothing deployed");
    if (entry.initialized) console.log(`  already initialised — ${entry.target.probe} answers`);
    else await initialise(run, entry);
  }

  console.log("\nend state");
  for (const entry of entries) {
    const account = entry.target.account;
    const chain = await chainInfo(net, account);
    if (chain.codeHash !== entry.localHash) fail(`${account} reports ${chain.codeHash}, expected ${entry.localHash}`);
    if (!(await isInitialized(net, account, entry.target.probe))) {
      fail(`${account} carries the right code but ${entry.target.probe} does not answer`);
    }
    console.log(`  ${account} — ${formatNear(chain.balance)} NEAR — ${accountUrl(net, account)}`);
  }
};

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
