// Integration and acceptance tests for demo runner (P11, Issues #139-#148)
import assert from "node:assert/strict";
import { test } from "node:test";

import { createDemoContext } from "../demo/context.js";
import { step1 } from "../demo/step1.js";
import { step2 } from "../demo/step2.js";
import { step3 } from "../demo/step3.js";
import { step4 } from "../demo/step4.js";
import { step5 } from "../demo/step5.js";
import { step6 } from "../demo/step6.js";
import { step7 } from "../demo/step7.js";
import { step8 } from "../demo/step8.js";
import { runDemo } from "../demo.js";
import { runSpamTest } from "../spam.js";

test("demo_steps_1_to_8_full_story", async () => {
  const ctx = await createDemoContext();

  // Step 1: Programme created & funded
  await step1(ctx);
  const prog1 = ctx.state.programme as { balance: string; reserved: string };
  assert.equal(prog1.balance, "5000000000");
  assert.equal(prog1.reserved, "0");

  // Step 2: Fictional files loaded
  await step2(ctx);
  assert.equal(ctx.rawFiles.length, 2);

  // Step 3: Cleaning, AI redaction, recusal
  await step3(ctx);
  assert.equal(ctx.cleanedFiles.length, 2);
  assert(ctx.cleaningReport);
  assert.equal(ctx.recusedPanelMembers.length, 1);
  assert(ctx.activePanelMembers.length >= 2);

  // Step 4: Submission + Spam test
  await step4(ctx);
  assert.equal(ctx.tipId, 1);
  assert(ctx.evidenceCid);
  const prog4 = ctx.state.programme as { balance: string; reserved: string };
  assert.equal(prog4.reserved, "0"); // invariant 1: submission reserves 0

  // Step 5: Triage & reservation invariant
  await step5(ctx);
  const tip5 = ctx.state.tip as { status: string; reward?: string };
  const prog5 = ctx.state.programme as { balance: string; reserved: string };
  assert.equal(tip5.status, "UnderReview");
  assert.equal(prog5.reserved, "1000000000"); // 1,000 tUSDC reserved

  // Step 6: Sputnik DAO proposal & vote
  await step6(ctx);
  const tip6 = ctx.state.tip as { status: string; reward: string };
  const prog6 = ctx.state.programme as { balance: string; reserved: string };
  assert.equal(tip6.status, "Accepted");
  assert.equal(tip6.reward, "800000000");
  assert.equal(prog6.reserved, "800000000"); // 200 tUSDC released

  // Step 7: Claim to fresh account
  await step7(ctx);
  const tip7 = ctx.state.tip as { status: string; reward: string };
  const prog7 = ctx.state.programme as { balance: string; reserved: string };
  assert.equal(tip7.status, "Paid");
  assert.equal(prog7.reserved, "0"); // reservation cleared
  assert.equal(ctx.claimDestinationAccount?.length, 64); // 64 hex implicit account

  // Step 8: Dead man's switch & keeper key release
  await step8(ctx);
  const switchTip = ctx.state.switchTip as { switch_triggered: boolean; released_keys: string[] };
  assert.equal(switchTip.switch_triggered, true);
  assert.equal(switchTip.released_keys.length >= 2, true);
});

test("spam_test_standalone", async () => {
  const result = await runSpamTest({ programmeId: 1, initialReserved: 0n });
  assert.equal(result.rejectedPowCount, 10);
  assert.equal(result.dismissedCount, 10);
  assert.equal(result.reserved, "0");
});

test("run_demo_end_to_end_under_6_minutes", async () => {
  const exitCode = await runDemo();
  assert.equal(exitCode, 0);
});
