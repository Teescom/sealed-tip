// The part of a seed run that is arithmetic rather than RPC (S-7.2): what `.env` says the demo state
// should be, and whether the chain already agrees. Keeping it here is what lets `pnpm seed` print a
// plan without a node, and lets a second run prove it has nothing to do.
import { createHash } from "node:crypto";

import { daoAccountId, DAO_VERSION, type DaoIdentity, type PanelMember } from "./dao.js";
import { optionalVar, requireVar, type EnvMap } from "./env.js";
import { formatNear, near, token } from "./units.js";

/** tUSDC is 6 decimals, like the USDC tipsters are paid in on mainnet. */
export const TOKEN_DECIMALS = 6;

export interface ProgrammeSpec {
  readonly title: string;
  readonly scopeUri: string;
  /** sha256 of `scope_uri`; the client checks the scope it was shown hashes to this. */
  readonly scopeHash: number[];
  /** Already scaled by `TOKEN_DECIMALS`, as NEP-141 wants them. */
  readonly maxReward: string;
  readonly fund: string;
  /** NEAR. `ops_balance` pays the storage deposits and gas drips a claim needs. */
  readonly gasDrip: string;
  readonly ops: string;
  readonly powBits: number;
  readonly timeScale: number;
}

/** Everything the panel DAO is asked to be, in the form both the factory call and the adoption check read. */
export interface DaoSpec {
  /** The label handed to the factory; the account is `<prefix>.<factory>`. */
  readonly prefix: string;
  readonly id: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly council: string[];
}

export interface SeedPlan {
  readonly factory: string;
  readonly dao: DaoSpec;
  readonly funder: string;
  /** What `add_proposal` demands; 2.0.0's default policy sets it to 1 NEAR. */
  readonly proposalBond: string;
  readonly programme: ProgrammeSpec;
}

const DEFAULTS = {
  title: "Open-source audit bounty (demo)",
  scopeUri: "https://scope.example.org/audit-rules",
  displayName: "Sealed Tip Review Panel",
  purpose: "Appoints the reviewers who adjudicate Sealed Tip submissions",
  maxReward: "500",
  fund: "1000",
  gasDrip: "0.05",
  ops: "0.5",
  powBits: "12",
  timeScale: "1",
};

const decimal = (value: bigint): string => value.toString();

export const seedPlan = (env: EnvMap): SeedPlan => {
  const factory = requireVar(env, "SPUTNIK_FACTORY");
  const prefix = requireVar(env, "PANEL_DAO_NAME");
  const id = daoAccountId(factory, prefix);
  const declared = optionalVar(env, "PANEL_DAO", "");
  if (declared.length > 0 && declared !== id) {
    throw new RangeError(`PANEL_DAO is "${declared}" but PANEL_DAO_NAME derives "${id}" — one of them is stale`);
  }
  const scopeUri = optionalVar(env, "SEED_SCOPE_URI", DEFAULTS.scopeUri);
  return {
    factory,
    dao: {
      prefix,
      id,
      displayName: optionalVar(env, "PANEL_DAO_DISPLAY", DEFAULTS.displayName),
      purpose: optionalVar(env, "PANEL_DAO_PURPOSE", DEFAULTS.purpose),
      council: [requireVar(env, "PANEL_1_ACCOUNT"), requireVar(env, "PANEL_2_ACCOUNT"), requireVar(env, "PANEL_3_ACCOUNT")],
    },
    funder: requireVar(env, "FUNDER_ACCOUNT"),
    proposalBond: decimal(near(optionalVar(env, "PROPOSAL_BOND_NEAR", "1"))),
    programme: {
      title: optionalVar(env, "SEED_PROGRAMME_TITLE", DEFAULTS.title),
      scopeUri,
      scopeHash: Array.from(createHash("sha256").update(scopeUri).digest()),
      maxReward: decimal(token(optionalVar(env, "SEED_MAX_REWARD_TUSDC", DEFAULTS.maxReward), TOKEN_DECIMALS)),
      fund: decimal(token(optionalVar(env, "SEED_FUND_TUSDC", DEFAULTS.fund), TOKEN_DECIMALS)),
      gasDrip: optionalVar(env, "SEED_GAS_DRIP_NEAR", DEFAULTS.gasDrip),
      ops: optionalVar(env, "SEED_OPS_NEAR", DEFAULTS.ops),
      powBits: integerOr(env, "SEED_POW_BITS", DEFAULTS.powBits),
      timeScale: integerOr(env, "SEED_TIME_SCALE", DEFAULTS.timeScale),
    },
  };
};

/** An integer that belongs in a contract argument, with a default for the demo's own settings. */
const integerOr = (env: EnvMap, name: string, fallback: string): number => {
  const value = Number(optionalVar(env, name, fallback));
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer, got "${fallback}"`);
  return value;
};

/** The programme row as the contract's JSON returns it — only the fields a re-run has to compare. */
export interface ProgrammeView {
  readonly id: number;
  readonly funder: string;
  readonly scope_uri: string;
  readonly panel_dao: string;
  readonly token: string;
  readonly balance: string;
  readonly panel: readonly PanelMember[];
}

/**
 * Re-running seeds one programme, not two: ours is the one with this scope that this funder opened.
 * A DAO that is not the one we asked for is a broken `.env`, not a second chance to create one.
 */
export const findProgramme = (
  programmes: readonly ProgrammeView[],
  want: { scopeUri: string; funder: string; dao: string; token: string },
): ProgrammeView | undefined => {
  const ours = programmes.filter(
    (p) => p.scope_uri === want.scopeUri && p.funder === want.funder && p.token === want.token,
  );
  const wrongDao = ours.find((p) => p.panel_dao !== want.dao);
  if (wrongDao !== undefined) {
    throw new Error(
      `programme ${wrongDao.id} already has panel_dao ${wrongDao.panel_dao}, not ${want.dao} — change PANEL_DAO_NAME or its programme`,
    );
  }
  return ours[0];
};

export type DaoDecision = { action: "create" } | { action: "adopt" };

/** An existing `<name>.<factory>` is adopted only if it is demonstrably ours. */
export const decideDao = (identity: DaoIdentity | undefined, want: SeedPlan): DaoDecision => {
  if (identity === undefined) return { action: "create" };
  const sameCouncil =
    identity.council.length === want.dao.council.length &&
    want.dao.council.every((member) => identity.council.includes(member));
  if (identity.version !== DAO_VERSION || !sameCouncil || identity.displayName !== want.dao.displayName) {
    throw new Error(
      `${want.dao.id} already exists and is not this project's panel (version ${identity.version}, ` +
        `display name "${identity.displayName}", council ${identity.council.join(", ")}). ` +
        `Set PANEL_DAO_NAME to a fresh name; the factory cannot rename an account.`,
    );
  }
  return { action: "adopt" };
};

const byAccount = (members: readonly PanelMember[]): string[] =>
  members.map((m) => m.account).sort();

/** `set_panel` replaces the whole list, so an equal set means the proposal has already run. */
export const panelMatches = (programme: ProgrammeView, members: readonly PanelMember[]): boolean =>
  byAccount(programme.panel).join() === byAccount(members).join();

/**
 * The three council slots the flow drives: one member locks the proposal bond, the other two supply
 * the second and third approving vote. Sputnik's default policy needs `(1 × 3) / 2 + 1 = 2` votes, so
 * no single member can appoint a panel — which is the property the demo is showing.
 */
export const panelRoles = (council: readonly string[]): { proposer: string; approvers: string[] } => {
  const [proposer, ...approvers] = council;
  if (proposer === undefined || approvers.length !== 2) {
    throw new RangeError(`the panel needs exactly 3 council members, got ${council.length}`);
  }
  return { proposer, approvers };
};

/**
 * The DAO's own `proposal_bond` is the only number `add_proposal` cares about; `PROPOSAL_BOND_NEAR`
 * exists because a DAO this run is about to create cannot be read first. A disagreement stops the
 * plan instead of quietly using one of them — the proposer's top-up is sized off this number, and a
 * bond bigger than it means the proposal is rejected for a missing deposit after the money has moved.
 */
export const resolveProposalBond = (chain: bigint | undefined, declared: bigint): bigint => {
  if (chain === undefined) return declared;
  if (chain !== declared) {
    throw new Error(
      `the DAO's proposal_bond is ${formatNear(chain)} NEAR, not the ${formatNear(declared)} in ` +
        `PROPOSAL_BOND_NEAR — set PROPOSAL_BOND_NEAR to ${formatNear(chain)}`,
    );
  }
  return chain;
};

/** What an account is short of to make its next call — 0 when it can already pay for it.
 * A panel member has to cover the 1 NEAR proposal bond out of its own balance, and the accounts
 * S-0.9 created hold 0.5, so this is the arithmetic that decides whether seed transfers first. */
export const shortfall = (have: bigint, need: bigint): bigint => (need > have ? need - have : 0n);
