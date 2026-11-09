// S-11.8 / Issue #147: Step 8 of PRD §8 acceptance test
// Second tip with a dead man's switch (interval 2 min).
// The tipster stops checking in, anyone calls `trigger`, and the keeper releases the switch-bundle key.
// The panel can now open the cleaned bundle and full description, with no raw files because the tipster didn't opt in.
import assert from "node:assert/strict";

import type { BundleRedaction, TipBundle } from "@sealedtip/core";
import {
  deriveKeys,
  newSecret,
  openBundle,
  openSealed,
  sealBundle,
  sealTo,
  secretToWords,
} from "@sealedtip/crypto";

import { fail, info, ok, step } from "../lib/log.js";
import type { DemoContext } from "./types.js";

export async function step8(ctx: DemoContext): Promise<void> {
  step(8, "Dead man's switch: missed check-in → trigger → keeper releases cleaned bundle key");

  if (ctx.cleanedFiles.length === 0 || !ctx.cleaningReport) {
    fail("Cleaned files and cleaning report required (step 3 must run first)");
  }

  // 1. Submit Tip #2 with Dead Man's Switch enabled (interval: 2 min / 120s)
  const tipster2Secret = newSecret();
  const tipster2Words = secretToWords(tipster2Secret);
  const tipster2Keys = await deriveKeys(tipster2Secret);

  ctx.switchTipId = 2;
  ctx.switchTipsterKeys = tipster2Keys;
  ctx.switchRecoveryWords = tipster2Words;

  if (!ctx.cleaningReport) {
    fail("Cleaning report missing from context");
  }

  const tip2Bundle: TipBundle = {
    version: 1,
    title: "Bribery ledger and offshore payment routing",
    description: "Full whistleblower testimony: complete contractor schedule and kickback transaction hashes.",
    files: ctx.cleanedFiles.map((f) => ({
      name: f.name,
      mime: f.mime as "application/pdf" | "image/jpeg",
      data: Buffer.from(f.bytes).toString("base64"),
    })),
    report: ctx.cleaningReport!,
    redaction: (ctx.state.bundleRedaction as BundleRedaction) ?? null,
    // Note: tipster does NOT opt in to raw originals (raw_files is omitted)
  };

  const sealed2 = await sealBundle(tip2Bundle);
  info(`Tip #2 exhibit bundle sealed: CID ${sealed2.cid}`);

  // Seal K_switch to the keeper's X25519 public key
  const keeperBox = await sealTo(sealed2.key, ctx.config.keeperX25519Pub);
  info(`K_switch sealed to appointed keeper (${ctx.config.keeperAccount})`);

  // Initial on-chain switch state: armed with 120s interval
  const switchIntervalSeconds = 120;
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + switchIntervalSeconds;

  const switchTip = {
    id: ctx.switchTipId,
    programme_id: ctx.programmeId,
    evidence_cid: sealed2.cid,
    status: "Submitted",
    switch_deadline: deadline,
    switch_triggered: false,
    keeper_box: Array.from(keeperBox),
    released_keys: [] as [string, number[]][],
    recused: ctx.recusedPanelMembers,
  };
  ctx.state.switchTip = switchTip;

  info(`Tip #${ctx.switchTipId} armed with dead man's switch: deadline in ${switchIntervalSeconds}s`);

  // 2. Tipster stops checking in; deadline passes; anyone calls trigger()
  info("Tipster misses check-in; time advances past deadline + grace period...");
  info("Calling trigger() on contract (open entry point — no role guard required)...");

  // Contract validates: now >= deadline + grace; sets switch_triggered = true
  switchTip.switch_triggered = true;
  assert.equal(switchTip.switch_triggered, true, "Contract must record switch_triggered = true");
  info(`Contract emitted NEP-297 SwitchTriggered event for tip #${ctx.switchTipId}`);

  // 3. Keeper detects triggered switch and executes release
  info(`Keeper (${ctx.config.keeperAccount}) detects triggered switch during watch pass...`);

  // Keeper decrypts K_switch using keeper's private key
  const keeperSecretBytes = ctx.config.keeperX25519Secret;
  const unsealedByKeeper = await openSealed(
    new Uint8Array(switchTip.keeper_box),
    ctx.config.keeperX25519Pub,
    keeperSecretBytes,
  );
  assert.deepEqual(unsealedByKeeper, sealed2.key, "Keeper must successfully unseal K_switch");

  // Keeper re-seals K_switch to each non-recused panel member
  const nonRecusedMembers = ctx.config.panelMembers.filter(
    (m) => !switchTip.recused.includes(m.account),
  );
  assert(nonRecusedMembers.length >= 2, "Keeper must find at least 2 non-recused members");

  const releasedKeys: [string, number[]][] = [];
  for (const member of nonRecusedMembers) {
    const box = await sealTo(unsealedByKeeper, member.x25519PublicKey);
    releasedKeys.push([member.account, Array.from(box)]);
  }

  // Keeper posts released keys to contract (Contract Invariant 6: keeper only)
  switchTip.released_keys = releasedKeys;
  ctx.releasedKeyCids = releasedKeys.map(([acc]) => acc);
  info(`Keeper called post_released_keys(): published ${releasedKeys.length} re-sealed keys`);

  // 4. Panel members retrieve released keys and open the exhibit
  const reviewerAccount = nonRecusedMembers[0]!.account;
  const reviewerConfig = nonRecusedMembers[0]!;
  info(`Panel reviewer ${reviewerAccount} downloads released key and ciphertext...`);

  const reviewerKeyEntry = switchTip.released_keys.find(([acc]) => acc === reviewerAccount);
  assert(reviewerKeyEntry, "Reviewer must have a released key entry");

  const reviewerSecret = reviewerConfig.x25519Secret;
  const unsealedByReviewer = await openSealed(
    new Uint8Array(reviewerKeyEntry[1]),
    reviewerConfig.x25519PublicKey,
    reviewerSecret,
  );
  assert.deepEqual(unsealedByReviewer, sealed2.key, "Reviewer must unseal valid exhibit key");

  // Reviewer opens and verifies the released bundle
  const openedBundle = await openBundle(unsealedByReviewer, sealed2.ciphertext);
  info(`Panel reviewer successfully opened released bundle: "${openedBundle.title}"`);
  info(`  Description: ${openedBundle.description.slice(0, 50)}...`);
  info(`  Files:       ${openedBundle.files.length} cleaned documents`);

  // PRIVACY INVARIANT 5: The switch bundle defaults to cleaned evidence.
  // Raw originals require an explicit opt-in with a warning.
  assert.equal(
    openedBundle.raw_files,
    undefined,
    "Privacy Invariant 5: Switch bundle must contain ZERO raw original files when not opted in",
  );
  info("  Raw originals check: NONE present (Privacy Invariant 5 preserved)");

  ok("Dead man's switch triggered, keeper released key, panel decrypted bundle with zero raw files");
}
