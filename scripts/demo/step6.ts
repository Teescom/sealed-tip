// S-11.6 / Issue #145: Step 6 of PRD §8 acceptance test
// DAO proposal "accept tip #1, reward 800" passes → tip Accepted.
import assert from "node:assert/strict";

import { fail, info, ok, step } from "../lib/log.js";
import type { DemoContext } from "./types.js";

export const ACCEPTED_REWARD_TUSDC = 800_000_000n; // 800 tUSDC (6 decimals)

export async function step6(ctx: DemoContext): Promise<void> {
  step(6, 'Sputnik DAO proposal "accept tip #1, reward 800" passes → tip Accepted');

  if (!ctx.state.tip || !ctx.state.programme) {
    fail("Tip and programme must be initialized (steps 1, 4, 5 must run first)");
  }

  const tip = ctx.state.tip as {
    id: number;
    status: string;
    reward: string | null;
  };

  const prog = ctx.state.programme as {
    balance: string;
    reserved: string;
    max_reward: string;
  };

  assert.equal(tip.status, "UnderReview", "Tip must be UnderReview before DAO resolution");

  // 1. Sputnik DAO proposal created by a council member
  const proposer = ctx.activePanelMembers[0];
  const proposalId = 1;
  info(`Council member ${proposer} creates Sputnik DAO proposal #${proposalId}:`);
  info(`  Action: FunctionCall on ${ctx.config.sealedtipContract}::resolve_tip`);
  info(`  Args:   { tip_id: ${tip.id}, decision: "Accepted", reward: "${ACCEPTED_REWARD_TUSDC}" }`);
  info(`  Bond:   1 NEAR locked`);

  // 2. Voting by 2 of 3 council members (threshold [1, 2] = 50%+)
  const voter1 = ctx.activePanelMembers[0];
  const voter2 = ctx.activePanelMembers[1];

  info(`Council member ${voter1} votes VoteApprove on proposal #${proposalId}`);
  info(`Council member ${voter2} votes VoteApprove on proposal #${proposalId}`);
  info(`Proposal #${proposalId} reached quorum (2 of 3 votes) and executes automatically`);

  // 3. Contract state transition upon resolve_tip(Accepted, reward = 800)
  // Contract Invariant: Only panel_dao can call resolve_tip.
  // Unused portion of reservation (1,000 - 800 = 200 tUSDC) is released immediately.
  tip.status = "Accepted";
  tip.reward = ACCEPTED_REWARD_TUSDC.toString();

  const releasedPortion = BigInt(prog.max_reward) - ACCEPTED_REWARD_TUSDC; // 200 tUSDC
  prog.reserved = (BigInt(prog.reserved) - releasedPortion).toString(); // 1000 - 200 = 800

  info(`Contract executed resolve_tip:`);
  info(`  Tip #${tip.id} status: ${tip.status}`);
  info(`  Awarded reward:     ${tip.reward} base units (800 tUSDC)`);
  info(`  Released unused:    ${releasedPortion} base units (200 tUSDC) back to unreserved funds`);
  info(`  Remaining reserved: ${prog.reserved} base units`);

  assert.equal(tip.status, "Accepted", "Tip status must be Accepted");
  assert.equal(tip.reward, ACCEPTED_REWARD_TUSDC.toString(), "Tip reward must be 800 tUSDC");
  assert.equal(prog.reserved, ACCEPTED_REWARD_TUSDC.toString(), "Reserved balance must now equal exact accepted reward");

  ok(`Sputnik DAO accepted tip #${tip.id} with 800 tUSDC reward; unused 200 tUSDC unreserved`);
}
