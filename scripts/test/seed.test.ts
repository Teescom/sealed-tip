// What `.env` says the demo state should be, and whether the chain already agrees (S-7.2). These are
// the decisions `seed.ts` prints in its dry run, so they need to be testable without a node.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { DAO_VERSION, panelMember, type DaoIdentity, type PanelMember } from "../lib/dao.js";
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
} from "../lib/seed.js";
import { YOCTO_PER_NEAR } from "../lib/units.js";

const SCOPE = "https://scope.example.org/audit-rules";
const BASE = {
  SPUTNIK_FACTORY: "sputnik-v2.testnet",
  PANEL_DAO_NAME: "sealedtip-panel",
  PANEL_1_ACCOUNT: "panel1.st-hack.testnet",
  PANEL_2_ACCOUNT: "panel2.st-hack.testnet",
  PANEL_3_ACCOUNT: "panel3.st-hack.testnet",
  FUNDER_ACCOUNT: "funder.st-hack.testnet",
};

test("seedPlan reads the demo state out of .env and derives the rest", () => {
  const plan = seedPlan(BASE);
  assert.equal(plan.factory, "sputnik-v2.testnet");
  assert.deepEqual(plan.dao, {
    prefix: "sealedtip-panel",
    id: "sealedtip-panel.sputnik-v2.testnet",
    displayName: "Sealed Tip Review Panel",
    purpose: "Appoints the reviewers who adjudicate Sealed Tip submissions",
    council: [BASE.PANEL_1_ACCOUNT, BASE.PANEL_2_ACCOUNT, BASE.PANEL_3_ACCOUNT],
  });
  assert.equal(plan.funder, BASE.FUNDER_ACCOUNT);
  assert.equal(plan.proposalBond, `${YOCTO_PER_NEAR}`);

  const spec = plan.programme;
  assert.equal(spec.scopeUri, SCOPE);
  assert.deepEqual(spec.scopeHash, Array.from(new Uint8Array(createHash("sha256").update(SCOPE).digest())));
  assert.equal(spec.scopeHash.length, 32);
  assert.equal(spec.maxReward, "500000000");
  assert.equal(spec.fund, "1000000000");
  assert.equal(spec.gasDrip, "0.05");
  assert.equal(spec.ops, "0.5");
  assert.equal(spec.powBits, 12);
  assert.equal(spec.timeScale, 1);
  assert.equal(TOKEN_DECIMALS, 6);
});

test("every demo setting can be overridden, in the units .env says it is in", () => {
  const plan = seedPlan({
    ...BASE,
    SEED_PROGRAMME_TITLE: "Road contract fraud — Fictional State",
    SEED_SCOPE_URI: "https://scope.example.org/road",
    SEED_MAX_REWARD_TUSDC: "1000",
    SEED_FUND_TUSDC: "5000",
    SEED_GAS_DRIP_NEAR: "0.02",
    SEED_OPS_NEAR: "1",
    SEED_POW_BITS: "8",
    SEED_TIME_SCALE: "3600",
    PROPOSAL_BOND_NEAR: "2",
  });
  assert.equal(plan.programme.title, "Road contract fraud — Fictional State");
  assert.equal(plan.programme.fund, "5000000000");
  assert.equal(plan.programme.maxReward, "1000000000");
  assert.equal(plan.programme.powBits, 8);
  assert.equal(plan.programme.timeScale, 3600);
  assert.equal(plan.proposalBond, `${2n * YOCTO_PER_NEAR}`);
  assert.notDeepEqual(plan.programme.scopeHash, seedPlan(BASE).programme.scopeHash);
});

test("a .env that contradicts itself stops the run instead of opening a second panel", () => {
  assert.throws(
    () => seedPlan({ ...BASE, PANEL_DAO: "other.sputnik-v2.testnet" }),
    /PANEL_DAO is "other.sputnik-v2.testnet" but PANEL_DAO_NAME derives/,
  );
  assert.doesNotThrow(() => seedPlan({ ...BASE, PANEL_DAO: "sealedtip-panel.sputnik-v2.testnet" }));
  for (const bits of ["0", "-1", "1.5", "abc"]) {
    assert.throws(() => seedPlan({ ...BASE, SEED_POW_BITS: bits }), RangeError, bits);
  }
  assert.throws(() => seedPlan({ ...BASE, PANEL_2_ACCOUNT: "" }), /missing PANEL_2_ACCOUNT/);
});

const row = (over: Partial<ProgrammeView> = {}): ProgrammeView => ({
  id: 0,
  funder: BASE.FUNDER_ACCOUNT,
  scope_uri: SCOPE,
  panel_dao: "sealedtip-panel.sputnik-v2.testnet",
  token: "tusdc.testnet",
  balance: "0",
  panel: [],
  ...over,
});

const WANT = {
  scopeUri: SCOPE,
  funder: BASE.FUNDER_ACCOUNT,
  dao: "sealedtip-panel.sputnik-v2.testnet",
  token: "tusdc.testnet",
};

test("re-running seeds one programme, not two", () => {
  assert.equal(findProgramme([], WANT), undefined);
  const ours = row({ id: 3 });
  const found = findProgramme([row({ id: 1, scope_uri: "https://elsewhere.example/rules" }), row({ id: 2, funder: "someone.testnet" }), ours], WANT);
  assert.equal(found?.id, 3, "the first match is ours, in the order the contract paginated them");

  // The same scope opened by the same funder against a different DAO is a stale `.env`, and adopting
  // it would silently point the demo at a panel nobody appointed.
  assert.throws(
    () => findProgramme([row({ id: 4, panel_dao: "old-panel.sputnik-v2.testnet" })], WANT),
    /programme 4 already has panel_dao old-panel.sputnik-v2.testnet/,
  );
});

const MEMBERS: PanelMember[] = [
  panelMember(BASE.PANEL_1_ACCOUNT, new Uint8Array(32).fill(1)),
  panelMember(BASE.PANEL_2_ACCOUNT, new Uint8Array(32).fill(2)),
  panelMember(BASE.PANEL_3_ACCOUNT, new Uint8Array(32).fill(3)),
];

const identity = (over: Partial<DaoIdentity> = {}): DaoIdentity => ({
  version: DAO_VERSION,
  displayName: "Sealed Tip Review Panel",
  council: MEMBERS.map((m) => m.account),
  proposalBond: YOCTO_PER_NEAR,
  ...over,
});

const PLAN = seedPlan(BASE);

test("an existing DAO is adopted only when it is demonstrably this project's panel", () => {
  assert.deepEqual(decideDao(undefined, PLAN), { action: "create" });
  assert.deepEqual(decideDao(identity(), PLAN), { action: "adopt" });
  // The order the council was created in is not part of its identity.
  assert.deepEqual(decideDao(identity({ council: [...MEMBERS].reverse().map((m) => m.account) }), PLAN), { action: "adopt" });

  for (const notOurs of [
    identity({ version: "3.0.0" }),
    identity({ displayName: "Someone else's DAO" }),
    identity({ council: ["a.testnet", "b.testnet", "c.testnet"] }),
    identity({ council: MEMBERS.map((m) => m.account).slice(0, 2) }),
  ]) {
    const which = `${notOurs.version} / "${notOurs.displayName}" / ${notOurs.council.join(",")}`;
    assert.throws(() => decideDao(notOurs, PLAN), /is not this project's panel/, which);
  }
});

test("a panel is up to date when it has these accounts", () => {
  assert.equal(panelMatches(row({ panel: MEMBERS }), MEMBERS), true);
  const shuffled = [MEMBERS[2]!, MEMBERS[0]!, MEMBERS[1]!];
  assert.equal(panelMatches(row({ panel: shuffled }), MEMBERS), true, "set_panel replaces the list, so membership is the whole question");
  assert.equal(panelMatches(row({ panel: MEMBERS.slice(0, 2) }), MEMBERS), false);
  assert.equal(panelMatches(row({ panel: [] }), MEMBERS), false);
});

test("2 of 3 votes pass a proposal, and nobody gets to do it alone", () => {
  const roles = panelRoles(MEMBERS.map((m) => m.account));
  assert.equal(roles.proposer, BASE.PANEL_1_ACCOUNT);
  assert.deepEqual(roles.approvers, [BASE.PANEL_2_ACCOUNT, BASE.PANEL_3_ACCOUNT]);
  assert.throws(() => panelRoles(["only.testnet", "two.testnet"]), /exactly 3 council members, got 2/);
  assert.throws(() => panelRoles(["a", "b", "c", "d"].map((x) => `${x}.testnet`)), /exactly 3 council members, got 4/);
});

test("the bond a proposal needs comes from the DAO, not from a stale .env", () => {
  // A DAO this run is about to create has no policy to read, so the configured number stands in — and
  // the appoint step reads it back before attaching it to `add_proposal`.
  assert.equal(resolveProposalBond(undefined, YOCTO_PER_NEAR), YOCTO_PER_NEAR);
  assert.equal(resolveProposalBond(2n * YOCTO_PER_NEAR, 2n * YOCTO_PER_NEAR), 2n * YOCTO_PER_NEAR);

  assert.throws(
    () => resolveProposalBond(2n * YOCTO_PER_NEAR, YOCTO_PER_NEAR),
    /proposal_bond is 2 NEAR, not the 1 in PROPOSAL_BOND_NEAR — set PROPOSAL_BOND_NEAR to 2/,
    "a bond bigger than the top-up would fail the proposal after the money had already moved",
  );
  assert.throws(
    () => resolveProposalBond(YOCTO_PER_NEAR, 2n * YOCTO_PER_NEAR),
    /set PROPOSAL_BOND_NEAR to 1$/,
    "the other direction is refused too: two different numbers in one run is the bug, whichever is bigger",
  );
});

test("shortfall is what decides whether money moves before a call", () => {
  assert.equal(shortfall(5n, 3n), 0n);
  assert.equal(shortfall(3n, 3n), 0n);
  assert.equal(shortfall(3n, 5n), 2n);
  assert.equal(shortfall(YOCTO_PER_NEAR / 2n, YOCTO_PER_NEAR), YOCTO_PER_NEAR / 2n, "a panel account holding 0.5 NEAR is 0.5 short of the 1 NEAR bond");
  assert.equal(shortfall(0n, YOCTO_PER_NEAR), YOCTO_PER_NEAR);
});
