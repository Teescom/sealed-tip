// S-7.2 — the demo state on testnet: one funded programme, and the three-member panel DAO that
// appointed itself as its reviewers.
//
//   pnpm seed              read the chain, print the plan, spend nothing
//   pnpm seed -- --apply   run it
//
// The panel is a real Sputnik DAO rather than an account this project controls, because the claim the
// demo has to make is that a funder cannot appoint the reviewers. `create` is called with no
// `public_key`, so the new DAO is given *no access key at all* and nothing happens on its behalf
// until two of the three council members vote — which is the flow this script drives, and the flow
// the demo then repeats by hand.
//
// The order the steps run in is the order the money has to move in: the DAO has to exist before the
// programme can name it, the programme before the panel can be appointed for it, and the token
// registration before the funder's tUSDC can land in it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DAO_WASM,
  addProposalArgs,
  daoCreateArgs,
  daoDeposit,
  daoIdentity,
  daoProposalBond,
  panelMember,
  type PanelMember,
} from "./lib/dao.js";
import { deployBuffer } from "./lib/deploy.js";
import { assertTestnet, loadEnv, requireVar, saveEnv, workspaceRoot } from "./lib/env.js";
import { ensureX25519, toHex } from "./lib/keys.js";
import { fail } from "./lib/log.js";
import {
  accountExists,
  accountUrl,
  chainInfo,
  codeHashOf,
  hasCode,
  openNet,
  transact,
  transactionUrl,
  transferNear,
  view,
  type Net,
} from "./lib/near.js";
import {
  TOKEN_DECIMALS,
  decideDao,
  findProgramme,
  panelMatches,
  panelRoles,
  resolveProposalBond,
  seedPlan,
  shortfall,
  type ProgrammeView,
} from "./lib/seed.js";
import { formatNear, formatUnits, near } from "./lib/units.js";

const APPLY = process.argv.includes("--apply");

const TGAS = 1_000_000_000_000n;
const GAS = {
  /** Sputnik 2.0.0's factory keeps 75 TGas for the DAO's `new` and 10 TGas for `on_create`. */
  createDao: 150n * TGAS,
  addProposal: 50n * TGAS,
  /** The DAO forwards only the gas the proposal asked for, so the vote needs room for both. */
  actProposal: 100n * TGAS,
  setPanel: 30n * TGAS,
  programme: 60n * TGAS,
  /** `ft_transfer_call` forwards all its unused gas to `ft_on_transfer` and reserves a slice for the resolver. */
  transferCall: 60n * TGAS,
  plain: 30n * TGAS,
};

/** Gas money a council member needs to propose or vote; the proposer also locks the bond. */
const VOTER_GAS = near("0.5");

/** A step of the run: the sentence describing it, and the work. Computing both up front is what makes
 * the dry run honest — it prints exactly what `--apply` will do, having already read the chain. */
interface Step {
  readonly describe: string;
  readonly spend: bigint;
  readonly run: () => Promise<void>;
}

/** Only the fields a re-run compares; the rest of the `Programme` row is the client's business. */
const programmeView = (row: unknown): ProgrammeView => {
  const p = row as Partial<ProgrammeView>;
  if (
    typeof p.id !== "number" ||
    typeof p.scope_uri !== "string" ||
    typeof p.funder !== "string" ||
    typeof p.token !== "string" ||
    typeof p.panel_dao !== "string" ||
    typeof p.balance !== "string" ||
    !Array.isArray(p.panel)
  ) {
    throw new Error(`list_programmes returned an unexpected row: ${JSON.stringify(row)}`);
  }
  return p as ProgrammeView;
};

/** A contract amount on the wire is a decimal string; anything else is not the contract this script was written for. */
const amountOf = (value: unknown, what: string): bigint => {
  if (typeof value !== "string") {
    throw new Error(`${what} did not answer with a decimal string: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
};

/** Every "it should be there by now" read goes through here, so the sentence names what is missing. */
const needProgramme = (row: ProgrammeView | undefined, who: string): ProgrammeView => {
  if (row === undefined) throw new Error(`${who} is not on chain — list_programmes does not show it`);
  return row;
};

const tUsdc = (units: bigint | string): string =>
  `${formatUnits(BigInt(units), TOKEN_DECIMALS)} tUSDC`;

/** `storage_balance_bounds` answers in yoctoNEAR strings; `min` is exactly what a registration costs. */
const storageDepositMin = async (net: Net, usdc: string): Promise<bigint> =>
  amountOf(
    (await view(net, usdc, "storage_balance_bounds") as { min?: unknown } | null)?.min,
    `${usdc}.storage_balance_bounds().min`,
  );

/** Sputnik's `add_proposal` returns the id it used, but the proposal is read back instead: the id is
 * needed by the vote, and `get_last_proposal_id` is the view 2.0.0 documents for it. */
const lastProposalId = async (net: Net, dao: string): Promise<number> => {
  const id = await view(net, dao, "get_last_proposal_id");
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0) {
    throw new Error(`${dao}.get_last_proposal_id returned ${JSON.stringify(id)}, expected a 0-based id`);
  }
  return id;
};

const main = async (): Promise<void> => {
  const { path: envPath, env } = loadEnv();
  assertTestnet(requireVar(env, "NEAR_NETWORK"));
  const net = await openNet(requireVar(env, "NEAR_RPC_URL"));

  const sealedtip = requireVar(env, "SEALEDTIP_CONTRACT");
  const usdc = requireVar(env, "TOKEN_CONTRACT");
  const deployer = { account: requireVar(env, "DEPLOYER_ACCOUNT"), envVar: "DEPLOYER_PRIVATE_KEY" };
  const funder = { account: requireVar(env, "FUNDER_ACCOUNT") };
  const plan = seedPlan(env);
  const spec = plan.programme;

  // Both contracts have to be the deploy script's doing already; seed only writes state into them.
  for (const account of [sealedtip, usdc]) {
    if (!hasCode(await chainInfo(net, account))) {
      fail(`${account} has no code — run pnpm deploy:testnet -- --apply first`);
    }
  }

  if (!existsSync(join(workspaceRoot(), DAO_WASM))) {
    fail(`${DAO_WASM} is missing, so the DAO's code cannot be checked against the audited build`);
  }
  const daoWasm = new Uint8Array(readFileSync(join(workspaceRoot(), DAO_WASM)));
  const pinnedHash = codeHashOf(daoWasm);

  // A panel member's X25519 key is what a tipster's report is sealed to, so — like the keeper's — it
  // is made once and kept in `.env`. Regenerating it would strand every submission sealed to the last.
  const members: PanelMember[] = [];
  const generated: Record<string, string> = {};
  for (const [index, account] of plan.dao.council.entries()) {
    const identity = await ensureX25519(env, `PANEL_${index + 1}_X25519_SECRET`);
    if (identity.generated) generated[identity.envVar] = toHex(identity.secret);
    members.push(panelMember(account, identity.publicKey));
  }
  const { proposer, approvers } = panelRoles(plan.dao.council);

  const findOurs = async (): Promise<ProgrammeView | undefined> => {
    const rows = await view(net, sealedtip, "list_programmes", { from_index: 0, limit: 100 });
    if (!Array.isArray(rows)) throw new Error(`${sealedtip}.list_programmes did not answer with a list`);
    return findProgramme(rows.map(programmeView), {
      scopeUri: spec.scopeUri,
      funder: funder.account,
      dao: plan.dao.id,
      token: usdc,
    });
  };

  const programme = await findOurs();
  // Reading the DAO's code hash before asking it who it is turns "someone took this name" into a
  // sentence about the name rather than a JSON parse error from an unrelated contract.
  const daoExists = await accountExists(net, plan.dao.id);
  const daoChain = daoExists ? await chainInfo(net, plan.dao.id) : undefined;
  if (daoChain !== undefined && daoChain.codeHash !== pinnedHash) {
    fail(
      `${plan.dao.id} runs ${daoChain.codeHash}, not the audited Sputnik build ${pinnedHash}. ` +
        `Set PANEL_DAO_NAME to a fresh name; the factory cannot rename an account.`,
    );
  }
  const daoOnChain = daoChain === undefined ? undefined : await daoIdentity(net, plan.dao.id);
  const dao = decideDao(daoOnChain, plan);
  // An adopted DAO already knows its own bond; one this run creates is the only case where the
  // configured number is a guess, and the appoint step below reads it back off the chain.
  const bond = resolveProposalBond(daoOnChain?.proposalBond, BigInt(plan.proposalBond));

  const unfunded = shortfall(BigInt(programme?.balance ?? "0"), BigInt(spec.fund));
  const funderBalance = amountOf(
    await view(net, usdc, "ft_balance_of", { account_id: funder.account }),
    `${usdc}.ft_balance_of(${funder.account})`,
  );
  const toMint = shortfall(funderBalance, unfunded);
  // near-api-js turns a JSON `null` into either null or undefined depending on the build, and both
  // mean the same thing here: `sealedtip` cannot receive tUSDC until somebody pays its storage.
  const registration = await view(net, usdc, "storage_balance_of", { account_id: sealedtip });
  const registered = registration !== null && registration !== undefined;
  const storageMin = registered ? 0n : await storageDepositMin(net, usdc);
  const needsPanel = programme === undefined || !panelMatches(programme, members);

  /** Set by the create step when this run opens the programme; every step that names it reads this. */
  let programmeId = programme?.id ?? -1;
  const knownProgrammeId = (): number => {
    if (programmeId < 0) fail("the programme is not on chain yet — this run should have created it");
    return programmeId;
  };
  /** For the sentences printed before any of it has happened. */
  const programmeLabel = (): string =>
    programmeId < 0 ? "the programme this run opens" : `programme ${programmeId}`;

  const steps: Step[] = [];
  const push = (describe: string, spend: bigint, run: () => Promise<void>): void => {
    steps.push({ describe, spend, run });
  };

  /** A member that cannot pay for its own gas is how a demo stalls at the vote, so the plan says so
   * before `--apply` rather than failing halfway through the third transaction. */
  const topUp = async (account: string, needed: bigint, why: string): Promise<void> => {
    const missing = shortfall((await chainInfo(net, account)).balance, needed);
    if (missing === 0n) return;
    push(`send ${formatNear(missing)} NEAR to ${account} so it can ${why}`, missing, async () => {
      console.log(`  ${transactionUrl(net, await transferNear(net, env, deployer, account, missing))}`);
    });
  };

  if (dao.action === "create") {
    const deposit = daoDeposit(daoWasm.length, await net.storageCostPerByte(), deployBuffer(env));
    push(
      `create ${plan.dao.id} through ${plan.factory} — ${formatNear(deposit)} NEAR attached, council ${plan.dao.council.join(", ")}`,
      deposit,
      async () => {
        const args = daoCreateArgs({
          displayName: plan.dao.displayName,
          purpose: plan.dao.purpose,
          council: plan.dao.council,
        });
        // No `public_key`: the DAO is created with no access key, so only a voted proposal can move it.
        const hash = await transact(
          net,
          env,
          deployer,
          plan.factory,
          "create",
          { name: plan.dao.prefix, public_key: null, args },
          GAS.createDao,
          deposit,
        );
        console.log(`  ${transactionUrl(net, hash)}`);
        if (!(await accountExists(net, plan.dao.id))) {
          fail(`${plan.dao.id} does not exist after the factory call — see ${transactionUrl(net, hash)}`);
        }
      },
    );
  }

  if (programme === undefined) {
    push(
      `open "${spec.title}" — ${tUsdc(spec.fund)} to be funded, max reward ${tUsdc(spec.maxReward)}, ` +
        `${spec.gasDrip} NEAR gas drip, ${spec.powBits} PoW bits, time_scale ${spec.timeScale}`,
      near(spec.ops),
      async () => {
        const hash = await transact(
          net,
          env,
          funder,
          sealedtip,
          "create_programme",
          {
            title: spec.title,
            scope_uri: spec.scopeUri,
            scope_hash: spec.scopeHash,
            panel_dao: plan.dao.id,
            token: usdc,
            max_reward: spec.maxReward,
            // Every contract amount travels as a decimal string: a bigint would die in JSON.stringify
            // and a JSON number past 2^53 would round.
            gas_drip: near(spec.gasDrip).toString(),
            pow_bits: spec.powBits,
            time_scale: spec.timeScale,
          },
          GAS.programme,
          near(spec.ops),
        );
        console.log(`  ${transactionUrl(net, hash)}`);
        const created = needProgramme(await findOurs(), `the programme ${funder.account} just opened`);
        programmeId = created.id;
      },
    );
  }

  if (!registered) {
    push(
      `register ${sealedtip} in the token — ${funder.account} pays ${formatNear(storageMin)} NEAR of storage`,
      storageMin,
      async () => {
        const hash = await transact(
          net,
          env,
          funder,
          usdc,
          "storage_deposit",
          { account_id: sealedtip, registration_only: true },
          GAS.plain,
          storageMin,
        );
        console.log(`  ${transactionUrl(net, hash)}`);
      },
    );
  }

  if (toMint > 0n) {
    push(`mint ${tUsdc(toMint)} to ${funder.account}`, 0n, async () => {
      const hash = await transact(
        net,
        env,
        funder,
        usdc,
        "mint",
        { account_id: funder.account, amount: toMint.toString() },
        GAS.plain,
      );
      console.log(`  ${transactionUrl(net, hash)}`);
    });
  }

  if (unfunded > 0n) {
    push(`move ${tUsdc(unfunded)} from ${funder.account} into ${programmeLabel()}`, 0n, async () => {
      const hash = await transact(
        net,
        env,
        funder,
        usdc,
        "ft_transfer_call",
        {
          receiver_id: sealedtip,
          amount: unfunded.toString(),
          memo: null,
          msg: JSON.stringify({ fund: knownProgrammeId() }),
        },
        GAS.transferCall,
        1n,
      );
      console.log(`  ${transactionUrl(net, hash)}`);
      // A `ft_on_transfer` panic lands in a later receipt, so this transaction reports success even
      // when the money came back. The balance re-read at the end of the run is the only real check.
    });
  }

  if (needsPanel) {
    for (const account of plan.dao.council) {
      await topUp(account, account === proposer ? bond + VOTER_GAS : VOTER_GAS, account === proposer ? "propose and vote" : "vote");
    }

    push(
      `appoint the panel for ${programmeLabel()}: ${proposer} proposes, ${approvers.join(" and ")} approve — 2 of 3 is what passes it`,
      0n,
      async () => {
        // A DAO created by this step could not be read at plan time, so this is where the assumed
        // bond meets the real one — before any deposit goes with the proposal.
        resolveProposalBond(await daoProposalBond(net, plan.dao.id), bond);
        const proposal = addProposalArgs({
          receiverId: sealedtip,
          methodName: "set_panel",
          description: `appoint the review panel for programme ${knownProgrammeId()}`,
          args: { programme_id: knownProgrammeId(), members },
          gas: GAS.setPanel,
        });
        // `add_proposal` is payable and locks the bond out of the proposer's own balance.
        const proposed = await transact(
          net,
          env,
          { account: proposer },
          plan.dao.id,
          "add_proposal",
          proposal,
          GAS.addProposal,
          bond,
        );
        console.log(`  proposed  ${transactionUrl(net, proposed)}`);
        const id = await lastProposalId(net, plan.dao.id);
        for (const voter of approvers) {
          // `act_proposal` is not payable, so nothing is attached; the second approval executes.
          const voted = await transact(
            net,
            env,
            { account: voter },
            plan.dao.id,
            "act_proposal",
            { id, action: "VoteApprove" },
            GAS.actProposal,
          );
          console.log(`  ${voter} approved proposal ${id}  ${transactionUrl(net, voted)}`);
        }
      },
    );
  }

  console.log(`network    ${net.network} — ${net.rpcUrl}`);
  console.log(`sealedtip  ${sealedtip}`);
  console.log(`token      ${usdc}`);
  console.log(`DAO        ${plan.dao.id} — ${daoOnChain === undefined ? "to create" : "adopt, already ours"}`);
  console.log(`bond       ${formatNear(bond)} NEAR per proposal, ${daoOnChain === undefined ? "assumed from PROPOSAL_BOND_NEAR" : "read from the DAO"}`);
  console.log(`panel      ${members.map((m) => `${m.account} (${toHex(new Uint8Array(m.x25519_pub)).slice(0, 8)}…)`).join(", ")}`);
  // A dry run derives these from keys it then throws away, so the public halves above are not what a
  // tipster should seal to — only `--apply` writes the secrets that make them permanent.
  if (Object.keys(generated).length > 0) {
    console.log(
      `           ${APPLY ? `newly created for ${Object.keys(generated).join(", ")}` : `${Object.keys(generated).join(", ")} not in .env yet; this dry run's copies are throwaway`}`,
    );
  }
  console.log(`funder     ${funder.account} — ${tUsdc(funderBalance)} in hand`);
  console.log(`programme  ${programme === undefined ? "to create" : `${programme.id}, ${tUsdc(programme.balance)} of ${tUsdc(spec.fund)} funded`}`);

  if (steps.length === 0) {
    console.log("\nnothing to do: the chain already holds this state.");
    return;
  }

  console.log(`\n${APPLY ? "applying" : "would do"}, in order:`);
  steps.forEach((step, index) => console.log(`  ${index + 1}. ${step.describe}`));
  const spend = steps.reduce((total, step) => total + step.spend, 0n);
  console.log(`\ntotal NEAR to move: ${formatNear(spend)}`);

  if (!APPLY) {
    console.log("\ndry run: nothing was sent.");
    console.log("apply with: pnpm seed -- --apply");
    return;
  }

  const written = saveEnv(envPath, { PANEL_DAO: plan.dao.id, ...generated });
  if (written.length > 0) console.log(`\nstored in ${envPath}: ${written.join(", ")} (0600, gitignored)`);

  for (const [index, step] of steps.entries()) {
    console.log(`\n${index + 1}. ${step.describe}`);
    await step.run();
  }

  // Everything a run claimed to do, read back off the chain rather than out of the receipts: an
  // accepted proposal shows up as the panel the programme stores, and a refunded transfer as a
  // balance that did not move.
  const final = needProgramme(await findOurs(), "the programme this run seeded");
  if (BigInt(final.balance) !== BigInt(spec.fund)) {
    fail(`programme ${final.id} holds ${tUsdc(final.balance)}, not ${tUsdc(spec.fund)}`);
  }
  if (!panelMatches(final, members)) {
    fail(`programme ${final.id} panel is ${final.panel.map((m) => m.account).join(", ") || "empty"} — the DAO proposal did not execute`);
  }
  const seeded = await chainInfo(net, plan.dao.id);
  if (seeded.codeHash !== pinnedHash) fail(`${plan.dao.id} runs ${seeded.codeHash}, not the audited ${pinnedHash}`);

  console.log("\nseeded");
  console.log(`  programme ${final.id} — ${accountUrl(net, sealedtip)}`);
  console.log(`  panel DAO — ${accountUrl(net, plan.dao.id)}, balance ${formatNear(seeded.balance)} NEAR`);
  console.log("  next: pnpm dev");
};

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
