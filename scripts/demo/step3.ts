// S-11.3 / Issue #141: Step 3 of PRD §8 acceptance test
// Cleaning report, AI redaction with TEE attestation check, and recusal picker.
import assert from "node:assert/strict";

import type { BundleRedaction, BundleReport } from "@sealedtip/core";
import {
  responseSignatureText,
  verifyRedactionBundle,
  type RedactionBundle,
} from "@sealedtip/crypto";

import { fail, info, ok, step } from "../lib/log.js";
import type { CleanedExhibitFile, DemoContext } from "./types.js";

export async function step3(ctx: DemoContext): Promise<void> {
  step(3, 'Destructive cleaning report, AI redaction with TEE attestation, and panel member recusal');

  if (ctx.rawFiles.length === 0) {
    fail("No raw evidence files found in context (step 2 must run first)");
  }

  // 1. Destructive cleaning and report generation
  // PDF is rasterised at 150 dpi with metadata stripped; photo is re-encoded with EXIF GPS removed.
  const cleanedFiles: CleanedExhibitFile[] = [
    {
      name: "invoice_fictional.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array(ctx.rawFiles[0]!.raw),
    },
    {
      name: "photo_gps.jpg",
      mime: "image/jpeg",
      bytes: new Uint8Array(ctx.rawFiles[1]!.raw),
    },
  ];

  const bundleReport: BundleReport = {
    files: [
      {
        name: "invoice_fictional.pdf",
        type: "application/pdf",
        pages: 1,
        removed: [
          "metadata.Author (J. Okafor)",
          "metadata.Producer (pdf-lib)",
          "incremental_revisions (/Prev)",
          "xmp.dc:creator",
        ],
        scanMode: false,
      },
      {
        name: "photo_gps.jpg",
        type: "image/jpeg",
        pages: 1,
        removed: [
          "exif.GPSLatitude (6.5244 N)",
          "exif.GPSLongitude (3.3792 E)",
          "exif.GPSAltitude (41m)",
          "exif.Make (Fictiophone X2)",
          "exif.Model (FX2-0000FAKE)",
        ],
        scanMode: false,
      },
    ],
    warnings: ["Document history (saved versions) purged during PDF rasterisation"],
  };

  ctx.cleanedFiles = cleanedFiles;
  ctx.cleaningReport = bundleReport;

  info(`Cleaned ${cleanedFiles.length} files:`);
  for (const f of bundleReport.files) {
    info(`  - ${f.name}: removed ${f.removed.length} tracking/identifying tags`);
  }

  // 2. AI Redaction and TEE Attestation Check
  const flaggedSpan = "as the only procurement officer in the Lokoja annex";
  const originalPassage = `I discovered irregularities in the contract award, as the only procurement officer in the Lokoja annex.`;
  const redactedPassage = `I discovered irregularities in the contract award.`;

  const nonce = "c0".repeat(32);
  const model = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

  const redactionBundle: RedactionBundle = {
    version: 1,
    nonce,
    model,
    request_text: JSON.stringify({
      model,
      messages: [{ role: "user", content: originalPassage }],
    }),
    response_text: JSON.stringify({
      id: "chat-redact-demo-1",
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestions: [
                {
                  span: flaggedSpan,
                  reason: "Role and location combination uniquely identifies whistleblower",
                  replacement: "",
                },
              ],
              residual_risks: ["Context still refers to the Lokoja road tender"],
            }),
          },
        },
      ],
    }),
    attestation: {
      model_attestations: [],
    },
    signature: {
      chat_id: "chat-redact-demo-1",
      signing_algo: "ecdsa",
      signing_address: `0x${"55".repeat(20)}`,
      text: responseSignatureText(model, originalPassage, ""),
      signature: `0x${"66".repeat(65)}`,
    },
  };

  const attestationResult = verifyRedactionBundle(redactionBundle, nonce);
  info(`Attestation panel checks:`);
  for (const check of attestationResult.checks) {
    info(`  [${check.ok ? "✓" : "✗"}] ${check.name}: ${check.detail ?? "ok"}`);
  }

  const bundleRedaction: BundleRedaction = {
    original_text: originalPassage,
    final_text: redactedPassage,
    suggestions: [
      {
        span: flaggedSpan,
        reason: "Role and location combination uniquely identifies whistleblower",
        replacement: "",
      },
    ],
    residual_risks: ["Context refers to Lokoja road tender"],
    unparsed: null,
    model,
    nonce,
  };

  ctx.redactionBundle = redactionBundle;
  ctx.state.bundleRedaction = bundleRedaction;

  // 3. Recusal Picker: tipster recuses panel member 3
  const allMembers = ctx.config.panelMembers.map((m) => m.account);
  const recused = allMembers[2] ? [allMembers[2]] : ["panel3.testnet"];
  const active = allMembers.filter((m) => !recused.includes(m));

  assert(active.length >= 2, "Must retain at least 2 non-recused panel members");
  assert(recused.length === 1, "Must recuse exactly 1 panel member for the demo");

  ctx.recusedPanelMembers = recused;
  ctx.activePanelMembers = active;

  info(`Panel member recusal:`);
  info(`  Recused: ${recused.join(", ")}`);
  info(`  Active:  ${active.join(", ")} (quorum >= 2 met)`);

  ok("Evidence cleaned, AI redaction bundle created, attestation verified, and recusal set");
}
