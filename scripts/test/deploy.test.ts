// The idempotency rule (S-7.1) is a function, not a comment: a second run must deploy nothing, move
// nothing and re-initialise nothing. These are the cases that decide that, over arithmetic with no
// node in it.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deployBuffer,
  deployPlan,
  planTarget,
  sealedtipInitArgs,
  type LocalCode,
  type OnChainCode,
} from "../lib/deploy.js";
import { EMPTY_CODE_HASH, hasCode, type ChainInfo } from "../lib/near.js";
import { YOCTO_PER_NEAR } from "../lib/units.js";

const LOCAL: LocalCode = { codeHash: "localBuildHash", bytes: 1000 };

const chain = (codeHash: string, codeBytes: number, storageUsage: number, balance: string): OnChainCode => ({
  codeHash,
  codeBytes,
  storageUsage,
  balance: BigInt(balance),
});

const plan = (
  onChain: OnChainCode,
  local: LocalCode,
  initialized: boolean,
  perByte = 10n,
  buffer = 5n,
) => planTarget({ account: "sealedtip.testnet", chain: onChain, local, initialized, storageCostPerByte: perByte, buffer });

test("an empty account is a first deploy: pay for the whole wasm, then initialise", () => {
  const out = plan(chain(EMPTY_CODE_HASH, 0, 0, "0"), LOCAL, false);
  assert.deepEqual(out, {
    account: "sealedtip.testnet",
    codeAction: "deploy",
    initAction: "init-after-deploy",
    topUp: 10_005n,
    requiredBalance: 10_005n,
  });
});

test("matching code hash moves no NEAR and calls nothing", () => {
  const same = chain(LOCAL.codeHash, 1000, 1200, "0");
  assert.deepEqual(plan(same, LOCAL, true), {
    account: "sealedtip.testnet",
    codeAction: "up-to-date",
    initAction: "already-initialised",
    topUp: 0n,
    requiredBalance: 12_005n,
  });
  // Deliberately not "needs a top-up": an up-to-date account is left alone even while broke, because
  // the run that would spend the money has nothing to spend it on.
  assert.equal(plan(same, LOCAL, true).topUp, 0n);

  // Code present but no state is the half-finished run, so only `new` is owed.
  assert.equal(plan(same, LOCAL, false).initAction, "init");
});

test("a redeploy pays only the difference in bytes", () => {
  const bigger = plan(chain("oldHash", 1000, 1200, "20000"), { codeHash: "newHash", bytes: 2000 }, true);
  assert.deepEqual(bigger, {
    account: "sealedtip.testnet",
    codeAction: "deploy",
    initAction: "already-initialised",
    topUp: 2005n,
    requiredBalance: 22_005n,
  });

  const smaller = plan(chain("oldHash", 2000, 2200, "0"), { codeHash: "newHash", bytes: 1000 }, true);
  assert.equal(smaller.requiredBalance, 12_005n);
  assert.equal(smaller.topUp, 12_005n, "freed storage is not refunded, so the balance still has to cover the bill");
});

test("the buffer is headroom above storage, and a negative byte count is a broken read", () => {
  const enough = plan(chain("oldHash", 1000, 1000, "50000"), { codeHash: "newHash", bytes: 2000 }, true);
  assert.equal(enough.requiredBalance, 20_005n);
  assert.equal(enough.topUp, 0n);

  assert.throws(
    () => plan(chain("oldHash", 2000, 500, "0"), { codeHash: "newHash", bytes: 1000 }, true),
    /reports 500 bytes of storage with 2000 bytes of code/,
  );
});

test("a real storage price and a real wasm length add up to a real deposit", () => {
  // testnet stakes 10^19 yoctoNEAR per byte, so 200 KB of code is 2 NEAR of storage and the 0.5 NEAR
  // buffer sits on top of it — the order of magnitude the deployer has to be holding.
  const perByte = 10n ** 19n;
  const out = plan(chain(EMPTY_CODE_HASH, 0, 0, "1000000000000000000000000"), { codeHash: "h", bytes: 200_000 }, false, perByte, YOCTO_PER_NEAR / 2n);
  assert.equal(out.requiredBalance, 2_500_000_000_000_000_000_000_000n);
  assert.equal(out.topUp, 1_500_000_000_000_000_000_000_000n);
});

test("only an account with the empty code hash counts as having no code", () => {
  const at = (codeHash: string): ChainInfo => ({ account: "a.testnet", codeHash, codeBytes: 0, storageUsage: 0, balance: 0n });
  assert.equal(hasCode(at(EMPTY_CODE_HASH)), false);
  assert.equal(hasCode(at("111111111111111111111111111111112")), true);
});

const FOUNDER = {
  DEPLOYER_ACCOUNT: "deployer.testnet",
  RELAYER_A_ACCOUNT: "rel1.testnet",
  RELAYER_B_ACCOUNT: "rel2.testnet",
  KEEPER_ACCOUNT: "keeper.testnet",
  TOKEN_CONTRACT: "tusdc.testnet",
  SEALEDTIP_CONTRACT: "sealedtip.testnet",
};

test("deployPlan puts the token first and names the wasm the build produces", () => {
  const { targets, config } = deployPlan({ ...FOUNDER }, "/repo");
  assert.deepEqual(targets.map((t) => t.label), ["mock-ft", "sealedtip"]);
  assert.deepEqual(targets.map((t) => t.account), ["tusdc.testnet", "sealedtip.testnet"]);
  assert.deepEqual(targets.map((t) => t.wasm), [
    "/repo/target/near/mock_ft/mock_ft.wasm",
    "/repo/target/near/sealedtip/sealedtip.wasm",
  ]);
  assert.equal(config.deployer, "deployer.testnet");
  assert.equal(config.owner, "deployer.testnet", "the deployer owns the contract unless told otherwise");
  assert.equal(config.ownerIsDefault, true);
  assert.deepEqual(config.relayers, ["rel1.testnet", "rel2.testnet"]);
  assert.equal(config.buffer, YOCTO_PER_NEAR / 2n);
  assert.equal(deployBuffer({}), YOCTO_PER_NEAR / 2n);
  assert.equal(deployBuffer({ DEPLOY_BUFFER_NEAR: "2" }), 2n * YOCTO_PER_NEAR);

  const sealed = targets[1]!.initArgs(new Uint8Array(32).fill(7));
  assert.equal(sealed.method, "new");
  assert.deepEqual(sealed.args, sealedtipInitArgs({
    owner: "deployer.testnet",
    relayers: ["rel1.testnet", "rel2.testnet"],
    keeperAccount: "keeper.testnet",
    keeperX25519Pub: new Uint8Array(32).fill(7),
  }));
  assert.ok(sealed.gas > 30_000_000_000_000n, "init gets more than the SDK default");
  assert.deepEqual(targets[0]!.initArgs(new Uint8Array(32)), { method: "new", args: {}, gas: sealed.gas });
});

test("OWNER_ACCOUNT moves ownership off the deployer, and a missing account stops the plan", () => {
  const { config } = deployPlan({ ...FOUNDER, OWNER_ACCOUNT: "allison.testnet" }, "/repo");
  assert.equal(config.owner, "allison.testnet");
  assert.equal(config.ownerIsDefault, false);

  assert.throws(() => deployPlan({ ...FOUNDER, RELAYER_B_ACCOUNT: "" }, "/repo"), /missing RELAYER_B_ACCOUNT/);
});

test("sealedtipInitArgs refuses a panel that could censor a submission alone", () => {
  const pub = new Uint8Array(32).fill(3);
  assert.deepEqual(sealedtipInitArgs({ owner: "o.testnet", relayers: ["a.testnet", "b.testnet"], keeperAccount: "k.testnet", keeperX25519Pub: pub }), {
    owner: "o.testnet",
    relayers: ["a.testnet", "b.testnet"],
    keeper: "k.testnet",
    keeper_x25519_pub: Array.from({ length: 32 }, () => 3),
  });
  assert.throws(() => sealedtipInitArgs({ owner: "o", relayers: ["only.testnet"], keeperAccount: "k", keeperX25519Pub: pub }), RangeError);
  assert.throws(() => sealedtipInitArgs({ owner: "o", relayers: ["same.testnet", "same.testnet"], keeperAccount: "k", keeperX25519Pub: pub }), /distinct/);
  assert.throws(() => sealedtipInitArgs({ owner: "o", relayers: ["a", "b"], keeperAccount: "k", keeperX25519Pub: new Uint8Array(31) }), /32 bytes, got 31/);
});
