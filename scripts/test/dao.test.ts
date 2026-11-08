// Every byte of JSON the panel DAO is created and driven with comes from upstream Sputnik 2.0.0's own
// deserialisers, and those are unforgiving in ways worth pinning: the council is a bare array (the
// policy enum is untagged), the inner call's arguments travel base64, and its deposit and gas are
// decimal strings, not numbers.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addProposalArgs,
  daoAccountId,
  daoCreateArgs,
  daoDeposit,
  parseDaoPolicy,
  panelMember,
  type FunctionCallInput,
} from "../lib/dao.js";
import { YOCTO_PER_NEAR, near } from "../lib/units.js";

const COUNCIL = ["panel1.testnet", "panel2.testnet", "panel3.testnet"];
const COUNCIL_BYTES = new Uint8Array(32).fill(11);

const fromBase64 = (value: string): unknown => JSON.parse(Buffer.from(value, "base64").toString("utf8"));

/** The single action a `ProposalKind::FunctionCall` carries, in 2.0.0's own `ActionCall` shape. */
interface ActionCall {
  method_name: string;
  args: string;
  deposit: string;
  gas: string;
}

const firstAction = (input: FunctionCallInput): ActionCall => {
  const proposal = addProposalArgs(input).proposal as {
    description: string;
    kind: { FunctionCall: { receiver_id: string; actions: ActionCall[] } };
  };
  assert.equal(proposal.description, input.description);
  assert.equal(proposal.kind.FunctionCall.receiver_id, input.receiverId);
  const action = proposal.kind.FunctionCall.actions[0];
  if (action === undefined) throw new Error("the proposal carried no action");
  return action;
};

test("the factory derives the DAO account from the name it was given", () => {
  assert.equal(daoAccountId("sputnik-v2.testnet", "panel"), "panel.sputnik-v2.testnet");
  for (const bad of ["ab", "-panel", "Panel", "pan.el", "x".repeat(33), ""]) {
    assert.throws(() => daoAccountId("sputnik-v2.testnet", bad), RangeError, JSON.stringify(bad));
  }
});

test("set_panel takes an account and a [u8; 32] that near-sdk reads as 32 JSON numbers", () => {
  const member = panelMember("panel1.testnet", COUNCIL_BYTES);
  assert.deepEqual(member, { account: "panel1.testnet", x25519_pub: Array.from({ length: 32 }, () => 11) });
  assert.throws(() => panelMember("panel1.testnet", new Uint8Array(31)), /32 bytes, got 31/);
});

test("the create argument is base64 of config plus a bare council array", () => {
  const encoded = daoCreateArgs({ displayName: "Sealed Tip Review Panel", purpose: "appoints reviewers", council: COUNCIL });
  const parsed = fromBase64(encoded) as { config: Record<string, unknown>; policy: unknown };

  assert.deepEqual(parsed.config, {
    name: "Sealed Tip Review Panel",
    purpose: "appoints reviewers",
    metadata: Buffer.from(JSON.stringify({ displayName: "Sealed Tip Review Panel" }), "utf8").toString("base64"),
  });

  // `VersionedPolicy` is untagged: an array selects Default(council), and `{"Default":[…]}` would be
  // read as a different variant entirely.
  assert.ok(Array.isArray(parsed.policy), `policy must be a bare array, got ${JSON.stringify(parsed.policy)}`);
  assert.deepEqual(parsed.policy, COUNCIL);

  assert.throws(() => daoCreateArgs({ displayName: "x", purpose: "y", council: COUNCIL.slice(0, 2) }), /exactly 3/);
  assert.throws(() => daoCreateArgs({ displayName: "x", purpose: "y", council: [...COUNCIL.slice(0, 2), COUNCIL[0]!] }), /exactly 3/);
});

test("the DAO deposit covers its code and rounds up to whole NEAR", () => {
  const perByte = 10n ** 19n;
  // 469,804 bytes is what S-0.7 pinned; ~1 KB is the rest of the account record, and the round up is
  // what the DAO spends on gas while it votes.
  assert.equal(daoDeposit(469_804, perByte, near("0.5")), 6n * YOCTO_PER_NEAR);
  assert.equal(daoDeposit(0, perByte, 0n), 1n * YOCTO_PER_NEAR, "never zero: an account with no balance cannot pay for a vote");
  assert.ok(daoDeposit(469_804, perByte, 0n) > BigInt(469_804 + 1_000) * perByte);
});

test("a proposal is one FunctionCall action with string amounts and base64 arguments", () => {
  const args = { programme_id: 0, members: [panelMember("panel1.testnet", COUNCIL_BYTES)] };
  const action = firstAction({
    receiverId: "sealedtip.testnet",
    methodName: "set_panel",
    description: "appoint the review panel for programme 0",
    args,
    gas: 30_000_000_000_000n,
  });
  assert.deepEqual(action, {
    method_name: "set_panel",
    args: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
    deposit: "0",
    gas: "30000000000000",
  });

  const bonded = firstAction({
    receiverId: "t.testnet",
    methodName: "m",
    description: "d",
    args: {},
    gas: 1n,
    deposit: YOCTO_PER_NEAR,
  });
  assert.equal(bonded.deposit, "1000000000000000000000000", "the DAO attaches the deposit the proposal names");
  assert.equal(bonded.gas, "1");
});

// The shape upstream 2.0.0 answers `get_policy` with, copied from three live DAOs on 2026-11-08 with
// the account ids swapped for this file's synthetic ones. `seed.ts` reads both fields off the chain
// instead of trusting `.env`, so a parse that guesses would propose with the wrong deposit.
const COUNCIL_ROLE = {
  name: "council",
  kind: { Group: ["panel1.testnet", "panel2.testnet", "panel3.testnet"] },
  permissions: { "*:AddProposal": "Role", "*:VoteApprove": "Role", "*:Finalize": "Role" },
};

const LIVE_POLICY = {
  roles: [{ name: "all", kind: { Everyone: null }, permissions: { "*:AddProposal": "Role" } }, COUNCIL_ROLE],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
  proposal_bond: "1000000000000000000000000",
  proposal_period: "604800000000000",
  bounty_bond: "1000000000000000000000000",
  bounty_forgiveness_period: "604800000000000",
};

test("get_policy answers with the council and the bond the proposer has to attach", () => {
  assert.deepEqual(parseDaoPolicy(LIVE_POLICY), { council: COUNCIL, proposalBond: YOCTO_PER_NEAR });
});

test("a policy that is not a 2.0.0 council policy is refused, not guessed at", () => {
  // The tagged form 3.x documents: it parses as an object, but there is no role list to read a council out of.
  assert.throws(() => parseDaoPolicy({ Default: COUNCIL }), /no council role/);
  assert.throws(() => parseDaoPolicy([]), /not a Sputnik v2 DAO/);
  assert.throws(() => parseDaoPolicy(null), /not a Sputnik v2 DAO/);

  const everyoneIsTheCouncil = { ...LIVE_POLICY, roles: [{ ...COUNCIL_ROLE, kind: { Everyone: null } }] };
  assert.throws(() => parseDaoPolicy(everyoneIsTheCouncil), /not a list of account ids/);

  // A JSON number for the bond is how a newer contract would answer, and this one is not that.
  const numericBond = { ...LIVE_POLICY, proposal_bond: 1_000_000_000_000_000_000_000_000 };
  assert.throws(() => parseDaoPolicy(numericBond), /expected a decimal string/);
});
