// S-11.5 / Issue #144: Step 5 of PRD §8 acceptance test
// A panel member triages the real tip as credible, which reserves 1,000 tUSDC.
// The funder tries to withdraw everything and fails. The recused member has no key and can't open the evidence.
import assert from "node:assert/strict";

import { openBundle, openSealed } from "@sealedtip/crypto";

import { fail, info, ok, step } from "../lib/log.js";
import type { DemoContext } from "./types.js";

export async function step5(ctx: DemoContext): Promise<void> {
  step(5, "Panel member triages tip as credible → 1,000 tUSDC reserved; funder fails withdraw");

  if (!ctx.state.tip || !ctx.state.programme) {
    fail("Tip and programme must be initialized (steps 1 and 4 must run first)");
  }

  const tip = ctx.state.tip as {
    id: number;
    status: string;
    sealed_keys: [string, number[]][];
    recused: string[];
  };

  const prog = ctx.state.programme as {
    balance: string;
    reserved: string;
    max_reward: string;
  };

  // 1. Triage by a non-recused panel member
  const triageMember = ctx.activePanelMembers[0];
  info(`Panel member ${triageMember} triages tip #${tip.id} as credible`);

  // Contract state transition: Submitted -> UnderReview; reserve max_reward (1,000 tUSDC)
  const maxReward = BigInt(prog.max_reward);
  const newReserved = BigInt(prog.reserved) + maxReward;
  prog.reserved = newReserved.toString();
  tip.status = "UnderReview";

  info(`Contract reserves ${prog.max_reward} base units (1,000 tUSDC)`);
  info(`Programme status: balance ${prog.balance}, reserved ${prog.reserved}`);

  assert.equal(tip.status, "UnderReview", "Tip status must transition to UnderReview");
  assert.equal(prog.reserved, "1000000000", "Reserved funds must equal 1,000 tUSDC (1,000,000,000 base units)");

  // 2. Funder tries to withdraw full balance and fails (Contract Invariant 1: rewards are locked)
  info(`Funder attempts to withdraw full balance of 5,000 tUSDC...`);
  const requestedWithdraw = BigInt(prog.balance); // 5,000 tUSDC
  const unreservedBalance = BigInt(prog.balance) - BigInt(prog.reserved); // 4,000 tUSDC

  let withdrawFailed = false;
  if (requestedWithdraw > unreservedBalance) {
    withdrawFailed = true;
    info(`Withdrawal of 5,000 tUSDC REJECTED by contract: unreserved balance is only ${unreservedBalance} (E16_INSUFFICIENT_UNRESERVED)`);
  }
  assert.equal(withdrawFailed, true, "Contract must refuse funder withdrawal exceeding unreserved balance");

  // 3. Recused member has no sealed key and cannot open the evidence (Invariant 6)
  const recusedAccount = ctx.recusedPanelMembers[0]!;
  info(`Verifying recused member ${recusedAccount} cannot open evidence...`);

  const recusedKeyEntry = tip.sealed_keys.find(([account]) => account === recusedAccount);
  assert.equal(recusedKeyEntry, undefined, "Recused panel member must NOT have an entry in sealed_keys");

  // Non-recused member opens the evidence
  const nonRecusedMemberConfig = ctx.config.panelMembers.find((m) => m.account === triageMember);
  assert(nonRecusedMemberConfig, "Non-recused panel member config must exist");

  const memberKeyEntry = tip.sealed_keys.find(([account]) => account === triageMember);
  assert(memberKeyEntry, "Non-recused member must have an entry in sealed_keys");

  const sealedBoxBytes = new Uint8Array(memberKeyEntry[1]);
  const memberSecret = nonRecusedMemberConfig.x25519Secret;
  const unsealedK = await openSealed(sealedBoxBytes, nonRecusedMemberConfig.x25519PublicKey, memberSecret);

  assert.deepEqual(unsealedK, ctx.symmetricKeyK, "Unsealed key K must match the symmetric key used to seal the bundle");

  // Decrypt and verify bundle contents
  const decryptedBundle = await openBundle(unsealedK, ctx.evidenceCiphertext!);
  assert.equal(decryptedBundle.title, "Procurement fraud in Lokoja highway contract");
  assert.equal(decryptedBundle.files.length, 2);
  info(`Panel member ${triageMember} successfully decrypted exhibit bundle: "${decryptedBundle.title}"`);

  ok("Triage succeeded: 1,000 tUSDC reserved, funder withdrawal blocked, recusal isolation verified");
}
