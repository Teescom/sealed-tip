// The tipster's submission and action pipeline (S-10.4, S-10.5, S-10.6).
//
// Nine steps for submit, and the order is the security order:
//   1. Clean files locally (destructive: rasterise PDF, re-encode image, optional scan mode).
//   2. Build the removal report (tag names and counts only; no values).
//   3. Optional AI redaction: text the tipster selected, verified against NEAR AI attestation.
//   4. Assemble TipBundle and enforce BUNDLE_MAX_BYTES.
//   5. Seal bundle: K = rand32; ciphertext = XChaCha20-Poly1305(K, bundle).
//   6. Upload ciphertext blob to store -> evidence_cid and evidence_hash.
//   7. Seal K to each non-recused panel member (>= 2 required) -> upload each sealed box.
//   8. Dead man's switch: read keeper_x25519_pub from chain, seal K, upload box.
//   9. Solve proof-of-work -> sign submitMessage -> POST /relay/submit_tip.
//
// The signed actions checkin, retract, and claim share the same identity model: 24 words -> HKDF keys,
// borsh action encoding, ed25519 sign, and submit via the relayer queue.

import {
  type BundleFile,
  type BundleReport,
  type CleanedMime,
  type Payout,
  type Programme,
  type SealedKey,
  type TipBundle,
} from "@sealedtip/core";
import {
  actionMessage,
  attestationHashOf,
  bytes32FromHex,
  deriveKeys,
  newSecret,
  reportHash,
  sealBundle,
  sealTo,
  secretToWords,
  sign,
  solvePow,
  submitMessage,
  toBase64,
  verifyRedactionBundle,
  type RedactionBundle,
  type SignedAction,
} from "@sealedtip/crypto";
import {
  buildReport,
  cleanFile,
  readBlob,
  sniffType,
  type CanvasHost,
  type ReportInput,
} from "@sealedtip/clean";

import { type TipApi } from "./api";
import { daysToNs } from "./config";

export interface FileInput {
  readonly name: string;
  readonly blob: Blob;
  readonly scanMode?: boolean | undefined;
}

export interface RawFileInput {
  readonly name: string;
  readonly blob: Blob;
}

export interface AiRedactionInput {
  readonly originalText: string;
  readonly finalText: string;
  readonly suggestions: Array<{ span: string; reason: string; replacement: string }>;
  readonly residualRisks: string[];
  readonly unparsed: string | null;
  readonly model: string;
  readonly nonce: string;
  readonly bundle: RedactionBundle;
}

export interface DeadMansSwitchOptions {
  readonly intervalDays: number;
  readonly graceDays: number;
  readonly includesRaw: boolean;
}

export type SubmitProgressStep =
  | { readonly phase: "cleaning"; readonly current: number; readonly total: number }
  | { readonly phase: "reporting" }
  | { readonly phase: "sealing" }
  | { readonly phase: "uploading-evidence" }
  | { readonly phase: "sealing-keys"; readonly current: number; readonly total: number }
  | { readonly phase: "mining-pow" }
  | { readonly phase: "signing" }
  | { readonly phase: "relaying" };

export interface SubmitTipDeps {
  readonly api: TipApi;
  readonly canvasHost: CanvasHost;
  readonly getKeeperInfo: () => Promise<{ keeper: string; keeper_x25519_pub: number[]; keeper_last_seen: string }>;
}

export interface SubmitTipFlowInput {
  readonly programme: Programme;
  readonly title: string;
  readonly description: string;
  readonly files: readonly FileInput[];
  readonly rawFiles?: readonly RawFileInput[] | undefined;
  readonly recused?: readonly string[] | undefined;
  readonly aiRedaction?: AiRedactionInput | undefined;
  readonly deadMansSwitch?: DeadMansSwitchOptions | undefined;
  /** 32 random bytes. If omitted, `newSecret()` is used. */
  readonly secret?: Uint8Array | undefined;
  readonly passphrase?: string | undefined;
  readonly onProgress?: ((step: SubmitProgressStep) => void) | undefined;
}

export interface SubmitTipFlowResult {
  readonly ok: true;
  readonly queuedUntil: number;
  readonly evidenceCid: string;
  readonly evidenceHash: Uint8Array;
  readonly claimPubkey: Uint8Array;
  readonly secret: Uint8Array;
  readonly secretWords: string[];
}

export const submitTipFlow = async (
  input: SubmitTipFlowInput,
  deps: SubmitTipDeps,
): Promise<SubmitTipFlowResult> => {
  if (!input.programme.open) {
    throw new Error(`programme ${input.programme.id} is closed to new tips`);
  }

  const recusedSet = new Set(input.recused ?? []);
  const recipients = input.programme.panel.filter((m) => !recusedSet.has(m.account));
  if (recipients.length < 2) {
    throw new Error(
      `at least 2 non-recused panel members are required to submit a tip (got ${recipients.length})`,
    );
  }

  // 1. Clean files locally
  const cleanedBundleFiles: BundleFile[] = [];
  const reportInputs: ReportInput[] = [];

  let fileIndex = 0;
  for (const f of input.files) {
    fileIndex++;
    input.onProgress?.({ phase: "cleaning", current: fileIndex, total: input.files.length });
    const cleanOpts = f.scanMode !== undefined ? { scanMode: f.scanMode } : {};
    const cleaned = await cleanFile(f.blob, deps.canvasHost, cleanOpts);
    const cleanedBytes = await readBlob(cleaned.cleaned);
    cleanedBundleFiles.push({
      name: f.name,
      mime: cleaned.cleanedType,
      data: await toBase64(cleanedBytes),
    });
    reportInputs.push({
      name: f.name,
      type: cleaned.cleanedType,
      original: f.blob,
      cleaned: cleaned.cleaned,
      scanMode: Boolean(f.scanMode),
      host: deps.canvasHost,
    });
  }

  // 2. Build report
  input.onProgress?.({ phase: "reporting" });
  const report: BundleReport = await buildReport(reportInputs);

  // Raw files if opted in
  let rawBundleFiles: BundleFile[] | undefined;
  if (input.deadMansSwitch?.includesRaw && input.rawFiles && input.rawFiles.length > 0) {
    rawBundleFiles = [];
    for (const r of input.rawFiles) {
      const mime = await sniffType(r.blob);
      if (mime === "refused") {
        throw new Error(`raw file "${r.name}" has an unsupported format; only PDF, PNG, and JPEG are allowed`);
      }
      const rawBytes = await readBlob(r.blob);
      rawBundleFiles.push({
        name: r.name,
        mime: mime as CleanedMime,
        data: await toBase64(rawBytes),
      });
    }
  }

  // 3. Optional AI redaction
  let attestationHashBytes: number[] | null = null;
  let bundleRedaction: TipBundle["redaction"] = null;
  if (input.aiRedaction) {
    const verification = verifyRedactionBundle(input.aiRedaction.bundle, input.aiRedaction.nonce);
    if (!verification.ok) {
      throw new Error("AI redaction bundle failed attestation verification");
    }
    const hexDigest = attestationHashOf(input.aiRedaction.bundle);
    attestationHashBytes = Array.from(bytes32FromHex(hexDigest));
    bundleRedaction = {
      original_text: input.aiRedaction.originalText,
      final_text: input.aiRedaction.finalText,
      suggestions: input.aiRedaction.suggestions,
      residual_risks: input.aiRedaction.residualRisks,
      unparsed: input.aiRedaction.unparsed,
      model: input.aiRedaction.model,
      nonce: input.aiRedaction.nonce,
    };
  }

  // 4. Assemble TipBundle
  const bundle: TipBundle = {
    version: 1,
    title: input.title,
    description: input.description,
    files: cleanedBundleFiles,
    report,
    redaction: bundleRedaction,
    raw_files: rawBundleFiles,
  };

  // 5. Seal bundle
  input.onProgress?.({ phase: "sealing" });
  const { key, ciphertext, cid: evidenceCid, hash: evidenceHash } = await sealBundle(bundle);

  // 6. Upload evidence blob
  input.onProgress?.({ phase: "uploading-evidence" });
  const putEvidence = await deps.api.putBlob(ciphertext);
  if (!putEvidence.ok) {
    throw new Error(`failed to upload evidence blob: ${putEvidence.error}`);
  }

  // 7. Seal K to each non-recused panel member and upload each sealed box
  const sealedKeys: SealedKey[] = [];
  let memberIndex = 0;
  for (const member of recipients) {
    memberIndex++;
    input.onProgress?.({ phase: "sealing-keys", current: memberIndex, total: recipients.length });
    const box = await sealTo(key, Uint8Array.from(member.x25519_pub));
    const putKey = await deps.api.putBlob(box);
    if (!putKey.ok) {
      throw new Error(`failed to upload sealed key for panel member ${member.account}: ${putKey.error}`);
    }
    sealedKeys.push({ member: member.account, cid: putKey.value.cid });
  }

  // 8. Dead man's switch
  let switchInput: {
    interval: string;
    grace: string;
    bundle_key_for_keeper: string;
    includes_raw: boolean;
  } | null = null;

  if (input.deadMansSwitch) {
    const keeperInfo = await deps.getKeeperInfo();
    const keeperBox = await sealTo(key, Uint8Array.from(keeperInfo.keeper_x25519_pub));
    const putKeeper = await deps.api.putBlob(keeperBox);
    if (!putKeeper.ok) {
      throw new Error(`failed to upload sealed key for keeper: ${putKeeper.error}`);
    }
    switchInput = {
      interval: daysToNs(input.deadMansSwitch.intervalDays),
      grace: daysToNs(input.deadMansSwitch.graceDays),
      bundle_key_for_keeper: putKeeper.value.cid,
      includes_raw: input.deadMansSwitch.includesRaw,
    };
  }

  // 9. Solve proof-of-work
  input.onProgress?.({ phase: "mining-pow" });
  const powNonce = await solvePow(evidenceHash, input.programme.pow_bits);

  // 10. Derive keys and sign submit message
  input.onProgress?.({ phase: "signing" });
  const secret = input.secret ?? newSecret();
  const keys = await deriveKeys(secret, input.passphrase);
  const msg = submitMessage(input.programme.id, evidenceHash, keys.ed25519.publicKey);
  const sigBytes = sign(msg, keys.ed25519.secretKey);
  const signatureBase64 = await toBase64(sigBytes);

  // 11. Relay submission
  input.onProgress?.({ phase: "relaying" });
  const submitArgs = {
    programme_id: input.programme.id,
    claim_pubkey: Array.from(keys.ed25519.publicKey),
    evidence_cid: evidenceCid,
    evidence_hash: Array.from(evidenceHash),
    sealed_keys: sealedKeys,
    recused: [...(input.recused ?? [])],
    cleaning_report_hash: Array.from(reportHash(report)),
    attestation_hash: attestationHashBytes,
    switch: switchInput,
    pow_nonce: Number(powNonce),
    signature: signatureBase64,
  };

  const relayResult = await deps.api.relay("submit_tip", submitArgs);
  if (!relayResult.ok) {
    throw new Error(`submission relay rejected: ${relayResult.error}`);
  }

  return {
    ok: true,
    queuedUntil: relayResult.value.queuedUntil,
    evidenceCid,
    evidenceHash,
    claimPubkey: keys.ed25519.publicKey,
    secret,
    secretWords: secretToWords(secret),
  };
};

export interface ActionFlowDeps {
  readonly api: TipApi;
  readonly contractId: string;
}

export interface CheckinInput {
  readonly tipId: number;
  readonly nonce: number;
  readonly secret: Uint8Array;
  readonly passphrase?: string | undefined;
}

export const checkinFlow = async (
  input: CheckinInput,
  deps: ActionFlowDeps,
): Promise<{ ok: true; queuedUntil: number }> => {
  const keys = await deriveKeys(input.secret, input.passphrase);
  const action: SignedAction = {
    contract: deps.contractId,
    tipId: input.tipId,
    nonce: input.nonce,
    action: "Checkin",
  };
  const msg = actionMessage(action);
  const sig = sign(msg, keys.ed25519.secretKey);
  const result = await deps.api.relay("checkin", {
    tip_id: input.tipId,
    nonce: input.nonce,
    signature: await toBase64(sig),
  });
  if (!result.ok) throw new Error(`checkin failed: ${result.error}`);
  return { ok: true, queuedUntil: result.value.queuedUntil };
};

export interface RetractInput {
  readonly tipId: number;
  readonly nonce: number;
  readonly secret: Uint8Array;
  readonly passphrase?: string | undefined;
}

export const retractFlow = async (
  input: RetractInput,
  deps: ActionFlowDeps,
): Promise<{ ok: true; queuedUntil: number }> => {
  const keys = await deriveKeys(input.secret, input.passphrase);
  const action: SignedAction = {
    contract: deps.contractId,
    tipId: input.tipId,
    nonce: input.nonce,
    action: "Retract",
  };
  const msg = actionMessage(action);
  const sig = sign(msg, keys.ed25519.secretKey);
  const result = await deps.api.relay("retract", {
    tip_id: input.tipId,
    nonce: input.nonce,
    signature: await toBase64(sig),
  });
  if (!result.ok) throw new Error(`retract failed: ${result.error}`);
  return { ok: true, queuedUntil: result.value.queuedUntil };
};

export interface ClaimInput {
  readonly tipId: number;
  readonly nonce: number;
  readonly payout: Payout;
  readonly secret: Uint8Array;
  readonly passphrase?: string | undefined;
}

export const claimFlow = async (
  input: ClaimInput,
  deps: ActionFlowDeps,
): Promise<{ ok: true; queuedUntil: number }> => {
  const keys = await deriveKeys(input.secret, input.passphrase);
  const action: SignedAction = {
    contract: deps.contractId,
    tipId: input.tipId,
    nonce: input.nonce,
    action: { Claim: { payout: input.payout } },
  };
  const msg = actionMessage(action);
  const sig = sign(msg, keys.ed25519.secretKey);
  const result = await deps.api.relay("claim", {
    tip_id: input.tipId,
    nonce: input.nonce,
    payout: input.payout,
    signature: await toBase64(sig),
  });
  if (!result.ok) throw new Error(`claim failed: ${result.error}`);
  return { ok: true, queuedUntil: result.value.queuedUntil };
};
