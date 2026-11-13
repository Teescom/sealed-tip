// Drive the deployed testnet contract through the PRD §8 story, one stage at a time, for real.
//
// Usage: pnpm live -- --stage <heartbeat|submit|triage|resolve|claim>
//
// Why this exists: `pnpm demo` runs the story against an in-memory chain, so it proves the logic and says
// nothing about whether the deployed wasm accepts the same calls in the same order. Every row that ends
// "on testnet" is gated on this file, and the whole run is testnet-only by construction — `openNet` refuses
// a node that does not answer `testnet`, and nothing here touches mainnet.
//
// The tipster's key is derived from a fixed label instead of a random secret so the stages can be run
// separately, in any order, days apart: `submit` today and `claim` tomorrow must still sign with the same
// key, or the claim would be a different tipster's. That key is published testnet litter, not a secret.
//
// The reward goes to a fresh implicit account generated here, which is what `/claim` does in the browser.
import { createHash } from "node:crypto";

import {
  actionMessage,
  cidOf,
  deriveKeys,
  encryptBundle,
  sealTo,
  sign,
  solvePow,
  submitMessage,
  x25519PublicKey,
} from "@sealedtip/crypto";

import { addProposalArgs, daoProposalBond } from "./lib/dao.js";
import { loadEnv, workspaceRoot } from "./lib/env.js";
import { fromHex, toHex } from "./lib/keys.js";
import { info, ok } from "./lib/log.js";
import { openNet, transact, view, type Net } from "./lib/near.js";

const GAS = 100n * 10n ** 12n;
const DAO_GAS = 200n * 10n ** 12n;
const REWARD = 400_000_000; // 400 tUSDC, under the programme's 500 cap.

const sha256 = (bytes: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(bytes).digest());

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

interface Setup {
  readonly net: Net;
  readonly env: Record<string, string | undefined>;
  readonly contract: string;
  readonly dao: string;
  readonly programme: number;
}

const setup = async (): Promise<Setup> => {
  const { env } = loadEnv(workspaceRoot());
  const rpcUrl = env.NEAR_RPC_URL;
  if (rpcUrl === undefined) throw new Error("NEAR_RPC_URL is not set in .env");
  const net = await openNet(rpcUrl);
  const contract = env.SEALEDTIP_CONTRACT;
  const dao = env.PANEL_DAO;
  if (contract === undefined || dao === undefined) throw new Error("SEALEDTIP_CONTRACT and PANEL_DAO must be set");
  return { net, env, contract, dao, programme: Number(arg("programme") ?? 0) };
};

const panelMember = (env: Record<string, string | undefined>, index: number): { account: string; secret: Uint8Array } => {
  const account = env[`PANEL_${index}_ACCOUNT`];
  const secretHex = env[`PANEL_${index}_X25519_SECRET`];
  if (account === undefined || secretHex === undefined) {
    throw new Error(`PANEL_${index}_ACCOUNT and PANEL_${index}_X25519_SECRET are both required`);
  }
  return { account, secret: fromHex(secretHex, `PANEL_${index}_X25519_SECRET`) };
};

/** The first tip id the chain does not have, i.e. the next one to be created. */
const nextTipId = async (s: Setup): Promise<number> => {
  for (let id = 0; id < 200; id++) {
    const tip = await view(s.net, s.contract, "get_tip_public", { tip_id: id });
    if (tip === null) return id;
  }
  throw new Error("200 tips and no null: this probe assumes ids are contiguous");
};

const stageHeartbeat = async (s: Setup): Promise<void> => {
  const before = (await view(s.net, s.contract, "get_keeper_info", { programme_id: s.programme })) as {
    keeper_last_seen: string;
  };
  const hash = await transact(
    s.net,
    s.env,
    { account: s.env.KEEPER_ACCOUNT ?? "", envVar: "KEEPER_KEY" },
    s.contract,
    "heartbeat",
    {},
    GAS,
  );
  const after = (await view(s.net, s.contract, "get_keeper_info", { programme_id: s.programme })) as {
    keeper_last_seen: string;
  };
  if (BigInt(after.keeper_last_seen) <= BigInt(before.keeper_last_seen)) {
    throw new Error(`heartbeat did not move keeper_last_seen: ${before.keeper_last_seen} -> ${after.keeper_last_seen}`);
  }
  ok(`keeper heartbeat on chain: ${hash}; keeper_last_seen ${before.keeper_last_seen} -> ${after.keeper_last_seen}`);
};

const submitTip = async (
  s: Setup,
  switchFor: ((bundleKey: Uint8Array) => Promise<Record<string, unknown>>) | null,
): Promise<{ tipId: number; bundleKey: Uint8Array }> => {
  // Deterministic per programme, so a later stage signs as the same tipster. Not a secret anyone should keep.
  const secret = sha256(new TextEncoder().encode(`sealedtip live e2e tipster v1 programme ${s.programme}`));
  const keys = await deriveKeys(secret);

  const plaintext = new TextEncoder().encode(
    "Fictional tip for the live acceptance run. This text exists only to be encrypted and never to accuse anyone.",
  );
  const { key: bundleKey, ciphertext } = await encryptBundle(plaintext);
  const evidenceCid = cidOf(ciphertext);
  const evidenceHash = sha256(ciphertext);

  // One sealed key per panel member: the contract requires at least two, and none may be recused.
  const sealedKeys: { member: string; cid: string }[] = [];
  for (let i = 1; i <= 3; i++) {
    const member = panelMember(s.env, i);
    sealedKeys.push({ member: member.account, cid: cidOf(await sealTo(bundleKey, await x25519PublicKey(member.secret))) });
  }

  const programme = (await view(s.net, s.contract, "get_programme", { programme_id: s.programme })) as {
    pow_bits: number;
  };
  const powNonce = await solvePow(evidenceHash, programme.pow_bits);
  const signature = sign(
    submitMessage(s.programme, evidenceHash, keys.ed25519.publicKey),
    keys.ed25519.secretKey,
  );

  const tipId = await nextTipId(s);
  const hash = await transact(
    s.net,
    s.env,
    { account: s.env.RELAYER_A_ACCOUNT ?? "", envVar: "RELAYER_A_KEY" },
    s.contract,
    "submit_tip",
    {
      programme_id: s.programme,
      claim_pubkey: Array.from(keys.ed25519.publicKey),
      evidence_cid: evidenceCid,
      evidence_hash: Array.from(evidenceHash),
      sealed_keys: sealedKeys,
      recused: [],
      cleaning_report_hash: Array.from(sha256(new TextEncoder().encode("live cleaning report"))),
      attestation_hash: null,
      switch: switchFor === null ? null : await switchFor(bundleKey),
      pow_nonce: Number(powNonce),
      signature: Buffer.from(signature).toString("base64"),
    },
    GAS,
  );

  const tip = (await view(s.net, s.contract, "get_tip_public", { tip_id: tipId })) as { status: string } | null;
  if (tip === null) throw new Error(`submit_tip sent (${hash}) but tip ${tipId} does not exist`);
  ok(`tip ${tipId} submitted by relayer A on chain: ${hash}; status ${tip.status}; PoW ${powNonce} at ${programme.pow_bits} bits`);
  return { tipId, bundleKey };
};

const stageSubmit = async (s: Setup): Promise<void> => {
  const { tipId } = await submitTip(s, null);
  info(`  run the next stage with: --stage triage --tip ${tipId}`);
};

const stageTriage = async (s: Setup): Promise<void> => {
  const tipId = Number(arg("tip"));
  const hash = await transact(
    s.net,
    s.env,
    { account: s.env.PANEL_1_ACCOUNT ?? "" },
    s.contract,
    "triage",
    { tip_id: tipId, credible: true },
    GAS,
  );
  const stats = (await view(s.net, s.contract, "get_programme_stats", { programme_id: s.programme })) as {
    reserved: string;
    under_review: number;
  };
  if (stats.under_review < 1) throw new Error(`triage sent (${hash}) but no tip is under review`);
  ok(`panel1 triaged tip ${tipId} as credible: ${hash}; reserved ${stats.reserved}, under review ${stats.under_review}`);
};

const stageResolve = async (s: Setup): Promise<void> => {
  const tipId = Number(arg("tip"));
  const panel1 = s.env.PANEL_1_ACCOUNT ?? "";
  const panel2 = s.env.PANEL_2_ACCOUNT ?? "";
  const description = `live acceptance run: accept tip ${tipId} at ${REWARD}`;

  // Find the proposal by its description rather than by `get_last_proposal_id`, which answers the *next*
  // id in Sputnik 2.0.0 (measured: it said 2 while the newest proposal was 1) and so votes on nothing.
  // Matching on the description also makes this stage resumable: a proposal already open is voted on
  // rather than replaced, which would burn a second 1 NEAR bond.
  const open = async (): Promise<number | undefined> => {
    const proposals = (await view(s.net, s.dao, "get_proposals", { from_index: 0, limit: 50 })) as {
      id: number;
      description: string;
      status: string;
    }[];
    return proposals.find((p) => p.description === description && p.status === "InProgress")?.id;
  };

  let id = await open();
  if (id === undefined) {
    const bond = await daoProposalBond(s.net, s.dao);
    info(`proposing resolve_tip on ${s.dao} with a ${bond} yoctoNEAR bond`);
    const proposal = addProposalArgs({
      receiverId: s.contract,
      methodName: "resolve_tip",
      description,
      args: { tip_id: tipId, accept: true, reward: String(REWARD) },
      gas: GAS,
    });
    const proposed = await transact(s.net, s.env, { account: panel1 }, s.dao, "add_proposal", proposal, DAO_GAS, bond);
    info(`proposal added by panel1: ${proposed}`);
    id = await open();
    if (id === undefined) throw new Error("add_proposal succeeded but no InProgress proposal matches the description");
  }

  // Sputnik executes when the threshold is reached, so the proposer's own vote plus one more is enough.
  // The loop is idempotent on purpose: once the threshold carries, the next vote re-executes the call and
  // the contract refuses it with E14 because the tip is already `Accepted`. That refusal is the success
  // case, so a throw is resolved by reading the chain rather than by retrying.
  const status = async (): Promise<string> => {
    const tip = (await view(s.net, s.contract, "get_tip_public", { tip_id: tipId })) as {
      status: string | Record<string, unknown>;
    } | null;
    return typeof tip?.status === "string" ? tip.status : Object.keys(tip?.status ?? {})[0] ?? "missing";
  };

  const votes: string[] = [];
  for (const account of [panel1, panel2]) {
    if ((await status()) === "Accepted") break;
    try {
      votes.push(
        await transact(s.net, s.env, { account }, s.dao, "act_proposal", { id, action: "VoteApprove" }, DAO_GAS),
      );
    } catch (error) {
      if ((await status()) !== "Accepted") throw error;
      info(`${account}'s vote re-executed an already-carried proposal; the tip is accepted, so that is the answer`);
    }
  }
  const tip = (await view(s.net, s.contract, "get_tip_public", { tip_id: tipId })) as { status: string } | null;
  ok(`DAO voted ${votes.length}x on ${s.dao}; tip ${tipId} is now ${tip?.status ?? "missing"}`);
  if (tip?.status !== "Accepted") throw new Error(`expected Accepted after the DAO vote, got ${tip?.status}`);
};

const stageClaim = async (s: Setup): Promise<void> => {
  const tipId = Number(arg("tip"));
  const secret = sha256(new TextEncoder().encode(`sealedtip live e2e tipster v1 programme ${s.programme}`));
  const keys = await deriveKeys(secret);

  // The fresh payout account: an implicit account is the hex of a public key, and it need not exist yet.
  const payoutKeys = await deriveKeys(sha256(new TextEncoder().encode(`sealedtip live e2e payout v1 tip ${tipId}`)));
  const payoutAccount = toHex(payoutKeys.ed25519.publicKey);
  const payout = { Near: { account: payoutAccount } };

  const nonce = Number(arg("nonce") ?? 1);
  const signature = sign(
    actionMessage({ contract: s.contract, tipId, nonce, action: { Claim: { payout } } }),
    keys.ed25519.secretKey,
  );

  const hash = await transact(
    s.net,
    s.env,
    { account: s.env.RELAYER_B_ACCOUNT ?? "", envVar: "RELAYER_B_KEY" },
    s.contract,
    "claim",
    { tip_id: tipId, payout, nonce, signature: Buffer.from(signature).toString("base64") },
    GAS,
  );

  const stats = (await view(s.net, s.contract, "get_programme_stats", { programme_id: s.programme })) as {
    paid: number;
    reserved: string;
  };
  const balance = (await view(s.net, s.env.TOKEN_CONTRACT ?? "", "ft_balance_of", { account_id: payoutAccount })) as string;
  ok(`claim from relayer B on chain: ${hash}`);
  ok(`paid ${stats.paid}; reserved now ${stats.reserved}; ${payoutAccount} holds ${balance} tUSDC base units`);
  if (BigInt(balance) !== BigInt(REWARD)) throw new Error(`payout account holds ${balance}, expected ${REWARD}`);
};



const SEC = 1_000_000_000n;
const SWITCH_INTERVAL = 20n * SEC;
const SWITCH_GRACE = 10n * SEC;

/** Upload the sealed keeper copy of K, because the contract stores only its cid and the daemon fetches it. */
const upload = async (apiUrl: string, bytes: Uint8Array): Promise<string> => {
  const response = await fetch(`${apiUrl}/blob`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
  });
  if (!response.ok) throw new Error(`POST ${apiUrl}/blob answered ${response.status}`);
  const body = (await response.json()) as { cid?: unknown };
  if (typeof body.cid !== "string") throw new Error("POST /blob answered without a cid");
  return body.cid;
};

/** Arm a tip with a switch whose keeper key is already sitting in the API's blob store. */
const armSwitchTip = async (s: Setup): Promise<number> => {
  const apiUrl = s.env.KEEPER_API_URL ?? s.env.NEXT_PUBLIC_API_URL;
  if (apiUrl === undefined) throw new Error("KEEPER_API_URL or NEXT_PUBLIC_API_URL must be set to store the keeper key");
  const keeperSecret = fromHex(s.env.KEEPER_X25519_SECRET ?? "", "KEEPER_X25519_SECRET");
  const { tipId } = await submitTip(s, async (key) => ({
    interval: SWITCH_INTERVAL.toString(),
    grace: SWITCH_GRACE.toString(),
    bundle_key_for_keeper: await upload(apiUrl, await sealTo(key, await x25519PublicKey(keeperSecret))),
    includes_raw: false,
  }));
  return tipId;
};

/** Wait for the chain's own clock to pass deadline + grace, then fire the permissionless trigger. */
const waitAndTrigger = async (s: Setup, tipId: number): Promise<string> => {
  const armed = (await view(s.net, s.contract, "get_tip_public", { tip_id: tipId })) as { switch_deadline: string | null };
  if (armed.switch_deadline === null) throw new Error(`tip ${tipId} has no switch deadline`);
  const ripe = BigInt(armed.switch_deadline) + SWITCH_GRACE + SEC;
  info(`tip ${tipId} armed to ${armed.switch_deadline}; waiting for chain time to pass ${ripe}`);
  for (;;) {
    const block = await s.net.provider.viewBlock({ finality: "final" });
    if (BigInt(block.header.timestamp) >= ripe) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return transact(
    s.net,
    s.env,
    { account: s.env.DEPLOYER_ACCOUNT ?? "", envVar: "DEPLOYER_PRIVATE_KEY" },
    s.contract,
    "trigger",
    { tip_id: tipId },
    GAS,
  );
};

const stageArm = async (s: Setup): Promise<void> => {
  const tipId = await armSwitchTip(s);
  ok(`tip ${tipId} armed; its keeper key is in the blob store, ready for the daemon`);
  info(`  start the keeper, then: --stage trigger --tip ${tipId}`);
};

const stageTrigger = async (s: Setup): Promise<void> => {
  const tipId = Number(arg("tip"));
  const triggered = await waitAndTrigger(s, tipId);
  const after = (await view(s.net, s.contract, "get_tip_public", { tip_id: tipId })) as { switch_triggered: boolean };
  if (!after.switch_triggered) throw new Error(`trigger sent (${triggered}) but switch_triggered is false`);
  ok(`tip ${tipId} switch fired on chain: ${triggered}; the keeper has one interval to notice`);
};

const stageSwitch = async (s: Setup): Promise<void> => {
  const SEC = 1_000_000_000n;
  const interval = 20n * SEC;
  const grace = 10n * SEC;

  const { tipId, bundleKey } = await submitTip(s, async (key) => {
    // The contract stores only a cid here, so the keeper's sealed copy of K never touches the chain.
    const keeperSecret = fromHex(s.env.KEEPER_X25519_SECRET ?? "", "KEEPER_X25519_SECRET");
    return {
      interval: interval.toString(),
      grace: grace.toString(),
      bundle_key_for_keeper: cidOf(await sealTo(key, await x25519PublicKey(keeperSecret))),
      includes_raw: false,
    };
  });

  const armed = (await view(s.net, s.contract, "get_tip_public", { tip_id: tipId })) as { switch_deadline: string | null };
  if (armed.switch_deadline === null) throw new Error("the tip was submitted without a switch deadline");
  const ripe = BigInt(armed.switch_deadline) + grace + SEC;
  info(`tip ${tipId} armed to ${armed.switch_deadline}; waiting for chain time to pass ${ripe}`);

  // Poll the block timestamp, never the wall clock: `trigger` compares against block time.
  for (;;) {
    const block = await s.net.provider.viewBlock({ finality: "final" });
    if (BigInt(block.header.timestamp) >= ripe) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // `trigger` is permissionless by design, so the deployer is only a convenient signer here.
  const triggered = await transact(
    s.net,
    s.env,
    { account: s.env.DEPLOYER_ACCOUNT ?? "", envVar: "DEPLOYER_PRIVATE_KEY" },
    s.contract,
    "trigger",
    { tip_id: tipId },
    GAS,
  );
  const after = (await view(s.net, s.contract, "get_tip_public", { tip_id: tipId })) as { switch_triggered: boolean };
  if (!after.switch_triggered) throw new Error(`trigger sent (${triggered}) but switch_triggered is false`);
  ok(`tip ${tipId} switch fired on chain after deadline + grace: ${triggered}`);

  // The keeper's half, done in-process because this run still holds K: re-seal it to each member.
  const released: { member: string; cid: string }[] = [];
  for (let i = 1; i <= 3; i++) {
    const member = panelMember(s.env, i);
    released.push({ member: member.account, cid: cidOf(await sealTo(bundleKey, await x25519PublicKey(member.secret))) });
  }
  const posted = await transact(
    s.net,
    s.env,
    { account: s.env.KEEPER_ACCOUNT ?? "", envVar: "KEEPER_KEY" },
    s.contract,
    "post_released_keys",
    { tip_id: tipId, keys: released },
    GAS,
  );
  const panelView = (await view(s.net, s.contract, "get_tip_for_panel", { tip_id: tipId })) as { released_keys: unknown[] };
  if (panelView.released_keys.length < 2) throw new Error("fewer than two released keys landed");
  ok(`keeper posted ${panelView.released_keys.length} released keys on chain: ${posted}`);
};

const run = async (): Promise<number> => {
  const stage = arg("stage");
  if (stage === undefined) {
    console.error("usage: pnpm live -- --stage <heartbeat|submit|triage|resolve|claim|switch|arm|trigger> [--tip N] [--programme N]");
    return 2;
  }
  const s = await setup();
  if (stage === "heartbeat") await stageHeartbeat(s);
  else if (stage === "submit") await stageSubmit(s);
  else if (stage === "triage") await stageTriage(s);
  else if (stage === "resolve") await stageResolve(s);
  else if (stage === "claim") await stageClaim(s);
  else if (stage === "switch") await stageSwitch(s);
  else if (stage === "arm") await stageArm(s);
  else if (stage === "trigger") await stageTrigger(s);
  else {
    console.error(`unknown stage: ${stage}`);
    return 2;
  }
  return 0;
};

process.exitCode = await run();
