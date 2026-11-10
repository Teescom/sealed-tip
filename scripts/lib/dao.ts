// The panel is a real Sputnik DAO v2.0.0 created through the live testnet factory (S-7.2), so its
// JSON comes from upstream 2.0.0 source rather than the newer 3.x docs everyone quotes: `name` is an
// unvalidated String, `VersionedPolicy` is untagged (the council is a bare array), and `U64`/`U128`
// amounts are decimal strings. All of that is assembled here, away from the RPC, so it can be tested.
import { base64Encode } from "near-api-js";

import { YOCTO_PER_NEAR } from "./units.js";
import { view, type Net } from "./near.js";

/**
 * The only DAO code this project claims to have audited: `contracts/sealedtip/res/sputnikdao2.wasm`,
 * whose provenance is recorded in `SPUTNIK_VERSION.txt` next to it (S-0.7). A chain that answers with
 * anything else is a different contract, so every DAO call in these scripts is refused first.
 */
export const DAO_WASM = "contracts/sealedtip/res/sputnikdao2.wasm";
export const DAO_VERSION = "2.0.0";

/** `create(name, …)` on the factory makes `<name>.<factory>`; keep it a legal label, since 2.0.0 will not. */
export const daoAccountId = (factory: string, name: string): string => {
  if (!/^[a-z0-9][-_a-z0-9]{2,31}$/.test(name)) {
    throw new RangeError(`DAO name "${name}" must be 3-32 characters of a-z0-9 and -_ starting with a letter or digit`);
  }
  return `${name}.${factory}`;
};

const b64 = (value: string): string => base64Encode(new TextEncoder().encode(value));

export interface PanelMember {
  readonly account: string;
  readonly x25519_pub: number[];
}

/** What `set_panel` takes. `x25519_pub` is a `[u8; 32]`, which near-sdk reads as 32 JSON numbers. */
export const panelMember = (account: string, x25519Pub: Uint8Array): PanelMember => {
  if (x25519Pub.length !== 32) {
    throw new RangeError(`panel X25519 public key must be 32 bytes, got ${x25519Pub.length}`);
  }
  return { account, x25519_pub: Array.from(x25519Pub) };
};

export interface DaoCreateInput {
  readonly displayName: string;
  readonly purpose: string;
  readonly council: string[];
}

/**
 * base64 of the JSON that `sputnikdao2::new(config, policy)` deserialises. `Config.metadata` is a
 * `Base64VecU8` the contract never reads, and a bare array for `policy` selects
 * `VersionedPolicy::Default(council)`, which upstream turns into the standard council role.
 */
export const daoCreateArgs = (input: DaoCreateInput): string => {
  const { displayName, purpose, council } = input;
  // Three is the number the approval arithmetic and E28 both assume: 2 of 3 must approve, and the
  // panel the contract stores has to have two distinct members.
  if (council.length !== 3 || new Set(council).size !== council.length) {
    throw new RangeError(`the panel DAO needs exactly 3 distinct council members, got ${council.join(", ") || "none"}`);
  }
  return b64(
    JSON.stringify({
      config: { name: displayName, purpose, metadata: b64(JSON.stringify({ displayName })) },
      policy: council,
    }),
  );
};

/**
 * Deploying the DAO wasm into the new account is what the deposit pays for. Live 2.0.0 DAOs report
 * 470,421-470,686 bytes of storage against 469,804 bytes of code, so the rest of the account record
 * is ~1 KB; the round up to a whole NEAR is what the DAO spends on gas while it votes.
 */
const DAO_STATE_BYTES = 1_000;

export const daoDeposit = (daoCodeBytes: number, storageCostPerByte: bigint, buffer: bigint): bigint => {
  const exact = BigInt(daoCodeBytes + DAO_STATE_BYTES) * storageCostPerByte + buffer;
  return (exact / YOCTO_PER_NEAR + 1n) * YOCTO_PER_NEAR;
};

export interface FunctionCallInput {
  readonly receiverId: string;
  readonly methodName: string;
  readonly description: string;
  /** The receiver's own named arguments; they travel to it as base64 JSON, untouched by the DAO. */
  readonly args: Record<string, unknown>;
  readonly gas: bigint;
  readonly deposit?: bigint;
}

/** The `proposal` argument of `add_proposal`. `ActionCall` in 2.0.0 spells deposit and gas as strings. */
export const addProposalArgs = (input: FunctionCallInput): { proposal: unknown } => ({
  proposal: {
    description: input.description,
    kind: {
      FunctionCall: {
        receiver_id: input.receiverId,
        actions: [
          {
            method_name: input.methodName,
            args: b64(JSON.stringify(input.args)),
            deposit: (input.deposit ?? 0n).toString(),
            gas: input.gas.toString(),
          },
        ],
      },
    },
  },
});

const isRecord = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} did not answer with an object, so this is not a Sputnik v2 DAO`);
  }
  return value as Record<string, unknown>;
};

const accountList = (value: unknown, what: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${what} is not a list of account ids: ${JSON.stringify(value)}`);
  }
  return value as string[];
};

export interface DaoIdentity {
  readonly version: string;
  readonly displayName: string;
  readonly council: string[];
  /** What `add_proposal` locks out of the proposer's own balance. */
  readonly proposalBond: bigint;
}

/**
 * The two parts of a 2.0.0 policy this project depends on. Verified against live DAOs created by
 * other people (2026-11-08): the council is the role named `council` with `kind.Group`, and
 * `proposal_bond` is the decimal string 1000000000000000000000000. A policy that answers with
 * anything else is a different contract, so it is refused rather than guessed at.
 */
export interface DaoPolicy {
  readonly council: string[];
  readonly proposalBond: bigint;
}

export const parseDaoPolicy = (policy: unknown): DaoPolicy => {
  const record = isRecord(policy, "get_policy()");
  const roles = Array.isArray(record.roles) ? record.roles : [];
  const council = roles.find((role) => isRecord(role, "role").name === "council");
  if (council === undefined) throw new Error("the policy has no council role, so nobody can vote on its proposals");
  const kind = isRecord(council.kind, "council role kind");
  if (typeof record.proposal_bond !== "string") {
    throw new Error(`policy.proposal_bond is ${JSON.stringify(record.proposal_bond)}, expected a decimal string`);
  }
  return { council: accountList(kind.Group, "council members"), proposalBond: BigInt(record.proposal_bond) };
};

/** The bond alone, for a run that has to know the number before it proposes. */
export const daoProposalBond = async (net: Net, dao: string): Promise<bigint> =>
  parseDaoPolicy(await view(net, dao, "get_policy")).proposalBond;

/**
 * A DAO that has just been created answers `get_last_proposal_id` with 0 whether it holds no
 * proposals or exactly one, id 0 — so a vote cannot trust that read to mean the proposal exists.
 * This waits until it can be read back, and refuses rather than voting on an id that is not there.
 */
export const waitForProposal = async (
  read: (id: number) => Promise<unknown>,
  id: number,
  { attempts = 30, intervalMs = 1_000 }: { attempts?: number; intervalMs?: number } = {},
): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const proposal = await read(id);
      if (proposal !== null && proposal !== undefined) return;
    } catch {
      // Sputnik DAO panics with ERR_NO_PROPOSAL until the proposal receipt completes
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`proposal ${id} still cannot be read after ${attempts} attempts — the propose transaction did not land`);
};

/**
 * Who this DAO says it is.
 */
export const daoIdentity = async (net: Net, dao: string): Promise<DaoIdentity> => {
  const version = await view(net, dao, "version");
  if (typeof version !== "string") throw new Error(`${dao}.version() returned ${JSON.stringify(version)}, expected a version string`);
  const config = isRecord(await view(net, dao, "get_config"), `${dao}.get_config()`);
  const policy = parseDaoPolicy(await view(net, dao, "get_policy"));
  return {
    version,
    displayName: typeof config.name === "string" ? config.name : String(config.name),
    council: policy.council,
    proposalBond: policy.proposalBond,
  };
};
