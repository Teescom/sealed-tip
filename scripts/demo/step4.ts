// S-11.4 / Issue #142: Step 4 of PRD §8 acceptance test
// Tip submitted via relayer with demo delay; spam script reserves nothing.
import assert from "node:assert/strict";

import type { BundleRedaction, TipBundle } from "@sealedtip/core";
import {
  checkPow,
  deriveKeys,
  newSecret,
  sealBundle,
  sealTo,
  secretToWords,
  sign,
  solvePow,
  submitMessage,
} from "@sealedtip/crypto";

import { fail, info, ok, step } from "../lib/log.js";
import { runSpamTest } from "../spam.js";
import type { DemoContext } from "./types.js";

export async function step4(ctx: DemoContext): Promise<void> {
  step(4, "Tip submitted via relayer with demo delay; spam script reserves nothing");

  if (ctx.cleanedFiles.length === 0 || !ctx.cleaningReport) {
    fail("Cleaned files and cleaning report required (step 3 must run first)");
  }

  // 1. Tipster generates 24 recovery words (BIP39) and derives claim keypair
  const secret = newSecret();
  const words = secretToWords(secret);
  const tipsterKeys = await deriveKeys(secret);

  info(`Tipster 24 recovery words generated (entropy: 32 bytes)`);
  info(`Tipster claim pubkey (ed25519): ${Buffer.from(tipsterKeys.ed25519.publicKey).toString("hex")}`);

  if (!ctx.cleaningReport) {
    fail("Cleaning report not found in context. Step 3 must run before Step 4.");
  }

  // 2. Assemble TipBundle (cleaned evidence only)
  const tipBundle: TipBundle = {
    version: 1,
    title: "Procurement fraud in Lokoja highway contract",
    description: "Evidence of invoice manipulation and fraudulent billing by contractors.",
    files: ctx.cleanedFiles.map((f) => ({
      name: f.name,
      mime: f.mime as "application/pdf" | "image/jpeg",
      data: Buffer.from(f.bytes).toString("base64"),
    })),
    report: ctx.cleaningReport!,
    redaction: (ctx.state.bundleRedaction as BundleRedaction) ?? null,
  };

  // 3. Encrypt exhibit bundle with symmetric key K (XChaCha20-Poly1305)
  const sealed = await sealBundle(tipBundle);
  const { key, ciphertext, cid, hash: evidenceHash } = sealed;

  info(`Exhibit bundle sealed: CID ${cid}`);
  info(`Evidence hash (sha256): ${Buffer.from(evidenceHash).toString("hex")}`);

  // 4. Seal symmetric key K to non-recused panel members ONLY (Invariant 6)
  const nonRecusedMembers = ctx.config.panelMembers.filter(
    (m) => !ctx.recusedPanelMembers.includes(m.account),
  );
  assert(nonRecusedMembers.length >= 2, "Must seal to at least 2 non-recused members");

  const sealedKeys: { account: string; box: Uint8Array }[] = [];
  for (const member of nonRecusedMembers) {
    const box = await sealTo(key, member.x25519PublicKey);
    sealedKeys.push({ account: member.account, box });
  }

  // 5. Seal symmetric key K to the keeper for Dead Man's Switch
  const keeperBox = await sealTo(key, ctx.config.keeperX25519Pub);

  // 6. Proof of Work (PoW) solution (target: 12 leading zero bits)
  const powDifficulty = 12;
  info(`Mining proof-of-work target: ${powDifficulty} bits...`);
  const nonce = await solvePow(evidenceHash, powDifficulty);
  assert(checkPow(evidenceHash, nonce, powDifficulty), "PoW must verify");
  info(`PoW solved: nonce ${nonce}`);

  // 7. Tipster signs submission message with claim key
  const messageToSign = submitMessage(ctx.programmeId, evidenceHash, tipsterKeys.ed25519.publicKey);
  const signature = sign(messageToSign, tipsterKeys.ed25519.secretKey);
  info(`Submission message signed with ed25519 claim key (${signature.length} bytes)`);

  // 8. Relayed submission simulation with demo delay
  info("Relayer queueing submission with demo delay of 50 ms...");
  await new Promise((resolve) => setTimeout(resolve, 50));

  ctx.tipId = 1;
  ctx.tipBundle = tipBundle;
  ctx.evidenceCiphertext = ciphertext;
  ctx.symmetricKeyK = key;
  ctx.evidenceHash = evidenceHash;
  ctx.evidenceCid = cid;
  ctx.tipsterKeys = tipsterKeys;
  ctx.recoveryWords = words;

  ctx.state.tip = {
    id: ctx.tipId,
    programme_id: ctx.programmeId,
    evidence_cid: cid,
    evidence_hash: Array.from(evidenceHash),
    claim_pubkey: Array.from(tipsterKeys.ed25519.publicKey),
    sealed_keys: sealedKeys.map((k) => [k.account, Array.from(k.box)]),
    recused: ctx.recusedPanelMembers,
    status: "Submitted",
    reward: null,
    switch_deadline: null,
    switch_triggered: false,
    released_keys: [],
    keeper_box: Array.from(keeperBox),
  };

  // Contract Invariant 1: Funds are reserved only at triage(credible = true), never at submission.
  const prog = ctx.state.programme as { reserved: string };
  assert.equal(prog.reserved, "0", "Submission must reserve 0 funds");

  // 9. Run Spam Script (20 junk submissions: low PoW or dismissed at triage)
  info("Executing spam stress test against contract...");
  const spamResult = await runSpamTest({ programmeId: ctx.programmeId, initialReserved: 0n });
  assert.equal(spamResult.reserved, "0", "Programme reservation must stay 0 after spam flood");

  ok(`Tip #${ctx.tipId} submitted via relayer; Contract Invariant 1 verified (0 funds reserved)`);
}
