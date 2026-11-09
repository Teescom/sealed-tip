"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  createViewClient,
  type Tip,
  type TipBundle,
  type Programme,
} from "@sealedtip/core";
import {
  openSealed,
  openBundle,
  x25519PublicKey,
  fromHex,
} from "@sealedtip/crypto";
import { createTipApi } from "../../lib/api";
import { publicConfig, type PublicConfig } from "../../lib/config";

const h = React.createElement;

export function CleaningReportViewInline({ report }: { report: TipBundle["report"] }) {
  if (report.files.length === 0 && report.warnings.length === 0) return null;
  return h(
    "div",
    { className: "rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4 text-emerald-200 text-sm" },
    h("div", { className: "mb-2 font-semibold text-emerald-300" }, "Cleaning Report"),
    report.warnings.map((w, i) =>
      h(
        "div",
        { key: i, className: "mb-2 text-xs text-amber-400 bg-amber-950/30 p-2 rounded border border-amber-800/30" },
        `⚠️ ${w}`,
      ),
    ),
    h(
      "div",
      { className: "space-y-2" },
      report.files.map((file, i) =>
        h(
          "div",
          { key: i, className: "rounded bg-black/40 p-2 border border-emerald-900/30" },
          h(
            "div",
            { className: "font-mono text-xs text-emerald-400 font-medium" },
            `${file.name} ${file.pages ? `(${file.pages} pages)` : ""}`,
          ),
          file.removed.length > 0
            ? h(
                "div",
                { className: "mt-1 text-xs text-neutral-300" },
                h("span", { className: "text-emerald-500" }, "Stripped metadata: "),
                file.removed.join(", "),
              )
            : h("div", { className: "mt-1 text-xs text-neutral-400" }, "No metadata tags found."),
        ),
      ),
    ),
  );
}

export function AttestationPanelInline(props: {
  bundleHash: string;
  model?: string | undefined;
  nonce?: string | undefined;
}) {
  return h(
    "div",
    { className: "rounded-lg border border-sky-800/40 bg-sky-950/20 p-4 text-sky-200 text-xs" },
    h(
      "div",
      { className: "mb-1 font-semibold text-sky-300 flex items-center gap-1.5" },
      h("span", null, "🔒 Verified TEE Attestation"),
    ),
    h(
      "p",
      { className: "text-sky-400 mb-2" },
      "Verified against the NEAR AI Cloud Intel TDX hardware attestation quote. Text never touches un-attested servers.",
    ),
    h(
      "div",
      { className: "font-mono space-y-1 text-[11px] text-sky-300" },
      h("div", null, h("span", { className: "text-sky-500" }, "Hash: "), props.bundleHash),
      props.model ? h("div", null, h("span", { className: "text-sky-500" }, "Model: "), props.model) : null,
      props.nonce ? h("div", null, h("span", { className: "text-sky-500" }, "Nonce: "), `${props.nonce.slice(0, 16)}…`) : null,
    ),
  );
}

export const RECUSAL_ALERT_MESSAGE =
  "You are recused from this tip. Per Invariant 6, you were not given a decryption key. Triage and decryption are blocked.";

export function toHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parsePrivateKey(input: string): Uint8Array {
  const clean = input.trim().replace(/^0x/, "");
  if (/^[0-9a-fA-F]{64}$/.test(clean)) {
    return fromHex(clean);
  }
  try {
    const binary = atob(clean);
    if (binary.length === 32) {
      return Uint8Array.from(binary, (c) => c.charCodeAt(0));
    }
  } catch {
    // not valid base64
  }
  throw new Error("Private key must be 32 bytes (64 hex characters or 32-byte base64)");
}

export async function derivePublicKey(secretKey: Uint8Array): Promise<Uint8Array> {
  return await x25519PublicKey(secretKey);
}

export function isRecused(tip: Tip, memberAccountId: string): boolean {
  if (!memberAccountId.trim()) return false;
  return tip.recused.includes(memberAccountId.trim());
}

export type ApiLike = {
  getBlob(cid: string): Promise<Uint8Array | { ok: boolean; value?: Uint8Array | null; error?: string } | null>;
};

export async function fetchBlobBytes(api: ApiLike, cid: string): Promise<Uint8Array> {
  const res = await api.getBlob(cid);
  if (res instanceof Uint8Array) {
    return res;
  }
  if (res && typeof res === "object" && "ok" in res) {
    if (!res.ok) {
      throw new Error(res.error || `Failed to fetch blob ${cid}`);
    }
    if (!res.value) {
      throw new Error(`Blob not found: ${cid}`);
    }
    return res.value;
  }
  if (res === null || res === undefined) {
    throw new Error(`Blob not found: ${cid}`);
  }
  throw new Error(`Unexpected blob response for ${cid}`);
}

export async function decryptPanelTip(
  deps: { api: ApiLike },
  tip: Tip,
  memberAccountId: string,
  secretKey: Uint8Array,
): Promise<TipBundle> {
  if (isRecused(tip, memberAccountId)) {
    throw new Error(RECUSAL_ALERT_MESSAGE);
  }

  const pubKey = await derivePublicKey(secretKey);
  let bundleKey: Uint8Array | null = null;

  // 1. First attempt to find the member's box explicitly
  const matchingKey = tip.sealed_keys.find((k) => k.member === memberAccountId.trim());
  if (matchingKey) {
    try {
      const boxBytes = await fetchBlobBytes(deps.api, matchingKey.cid);
      bundleKey = await openSealed(boxBytes, pubKey, secretKey);
    } catch {
      // Fall through to trial decryption across all boxes
    }
  }

  // 2. If not found or failed, attempt openSealed across all sealed keys
  if (!bundleKey) {
    for (const keyEntry of tip.sealed_keys) {
      try {
        const boxBytes = await fetchBlobBytes(deps.api, keyEntry.cid);
        const candidate = await openSealed(boxBytes, pubKey, secretKey);
        if (candidate && candidate.length === 32) {
          bundleKey = candidate;
          break;
        }
      } catch {
        // Not this key entry, continue
      }
    }
  }

  if (!bundleKey) {
    throw new Error(
      "Unable to unwrap symmetric key K from any sealed box in tip. Check your private key or member account ID.",
    );
  }

  // 3. Download evidence ciphertext
  const evidenceCiphertext = await fetchBlobBytes(deps.api, tip.evidence_cid);

  // 4. Open bundle with unwrapped key K
  return await openBundle(bundleKey, evidenceCiphertext);
}

export interface DaoProposalResult {
  proposal: {
    description: string;
    kind: {
      FunctionCall: {
        receiver_id: string;
        actions: Array<{
          method_name: string;
          args: string;
          deposit: string;
          gas: string;
        }>;
      };
    };
  };
  resolveArgs: Record<string, unknown>;
  base64Args: string;
}

export function generateDaoProposal(params: {
  contractId: string;
  tipId: number;
  outcome: "Accept" | "Reject";
  rewardUSDC?: number | string | undefined;
}): DaoProposalResult {
  const { contractId, tipId, outcome, rewardUSDC } = params;

  let resolveArgs: Record<string, unknown>;
  let description: string;

  if (outcome === "Accept") {
    const numericReward = Number(rewardUSDC ?? 0);
    const rewardBaseUnits = (BigInt(Math.round(numericReward * 1_000_000))).toString();
    resolveArgs = {
      tip_id: tipId,
      accept: true,
      reward: rewardBaseUnits,
      outcome: { Accept: { reward: rewardBaseUnits } },
    };
    description = `Resolve tip #${tipId} as Accept (reward: ${numericReward} USDC)`;
  } else {
    resolveArgs = {
      tip_id: tipId,
      accept: false,
      reward: null,
      outcome: { Reject: null },
    };
    description = `Resolve tip #${tipId} as Reject`;
  }

  const jsonStr = JSON.stringify(resolveArgs);
  const base64Args = btoa(jsonStr);

  const proposal = {
    description,
    kind: {
      FunctionCall: {
        receiver_id: contractId,
        actions: [
          {
            method_name: "resolve_tip",
            args: base64Args,
            deposit: "0",
            gas: "100000000000000",
          },
        ],
      },
    },
  };

  return { proposal, resolveArgs, base64Args };
}

export function generateTriageCliCommand(params: {
  contractId: string;
  tipId: number;
  credible: boolean;
  memberAccountId: string;
}): string {
  const argsJson = JSON.stringify({ tip_id: params.tipId, credible: params.credible });
  return `near call ${params.contractId} triage '${argsJson}' --accountId ${params.memberAccountId} --gas 30000000000000`;
}

export function generateProposalCliCommand(params: {
  panelDao: string;
  proposalPayload: Record<string, unknown>;
  memberAccountId: string;
  depositBondNear?: string | undefined;
}): string {
  const bond = params.depositBondNear ?? "0.1";
  const json = JSON.stringify(params.proposalPayload);
  return `near call ${params.panelDao} add_proposal '${json}' --accountId ${params.memberAccountId} --deposit ${bond} --gas 150000000000000`;
}

export function generateVoteCliCommand(params: {
  panelDao: string;
  proposalId: number | string;
  memberAccountId: string;
}): string {
  return `near call ${params.panelDao} act_proposal '{"id": ${params.proposalId}, "action": "VoteApprove"}' --accountId ${params.memberAccountId} --gas 100000000000000`;
}

export default function PanelPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [memberAccount, setMemberAccount] = useState("panel1.testnet");
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [tipIdInput, setTipIdInput] = useState("0");

  const [loadingTip, setLoadingTip] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [programme, setProgramme] = useState<Programme | null>(null);

  const [decrypting, setDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<TipBundle | null>(null);

  // Proposal State
  const [voteOutcome, setVoteOutcome] = useState<"Accept" | "Reject">("Accept");
  const [rewardUsdc, setRewardUsdc] = useState("500");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // File preview state
  const [previewFile, setPreviewFile] = useState<{ name: string; mime: string; dataUrl: string } | null>(null);

  useEffect(() => {
    const res = publicConfig();
    if (res.ok) {
      setConfig(res.config);
    } else {
      setConfig({
        network: "testnet",
        rpcUrl: "https://rpc.testnet.near.org",
        contractId: "sealedtip.testnet",
        apiUrl: "http://localhost:8787",
        tokenContract: "usdc.testnet",
      });
    }
  }, []);

  const handleFetchTip = async () => {
    if (!config) return;
    const tipId = Number.parseInt(tipIdInput, 10);
    if (Number.isNaN(tipId) || tipId < 0) {
      setTipError("Please enter a valid non-negative tip ID number.");
      return;
    }

    setLoadingTip(true);
    setTipError(null);
    setBundle(null);
    setDecryptError(null);

    try {
      const views = createViewClient(config.rpcUrl, config.contractId);
      const fetchedTip = await views.getTipForPanel(tipId);
      if (!fetchedTip) {
        setTip(null);
        setTipError(`Tip #${tipId} was not found on chain.`);
        return;
      }
      setTip(fetchedTip);

      try {
        const p = await views.getProgramme(fetchedTip.programme_id);
        if (p) {
          setProgramme(p);
          const maxNum = Number(p.max_reward) / 1_000_000;
          if (maxNum > 0) {
            setRewardUsdc(String(maxNum));
          }
        }
      } catch {
        // Programme view optional
      }
    } catch (err) {
      setTipError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTip(false);
    }
  };

  const handleDecrypt = async () => {
    if (!tip || !config) return;
    if (isRecused(tip, memberAccount)) {
      setDecryptError(RECUSAL_ALERT_MESSAGE);
      return;
    }

    setDecrypting(true);
    setDecryptError(null);

    try {
      const secretKey = parsePrivateKey(privateKeyInput);
      const api = createTipApi(config.apiUrl);
      const decrypted = await decryptPanelTip({ api }, tip, memberAccount, secretKey);
      setBundle(decrypted);
    } catch (err) {
      setDecryptError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecrypting(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const recused = tip ? isRecused(tip, memberAccount) : false;
  const contractId = config?.contractId ?? "sealedtip.testnet";
  const panelDao = programme?.panel_dao ?? "whistleblower-dao.sputnik-dao.near";

  const tipIdNum = tip ? tip.id : Number.parseInt(tipIdInput, 10) || 0;
  const proposalData = generateDaoProposal({
    contractId,
    tipId: tipIdNum,
    outcome: voteOutcome,
    rewardUSDC: rewardUsdc,
  });

  const triageCredibleCmd = generateTriageCliCommand({
    contractId,
    tipId: tipIdNum,
    credible: true,
    memberAccountId: memberAccount,
  });

  const triageDismissCmd = generateTriageCliCommand({
    contractId,
    tipId: tipIdNum,
    credible: false,
    memberAccountId: memberAccount,
  });

  const proposalCliCmd = generateProposalCliCommand({
    panelDao,
    proposalPayload: proposalData.proposal,
    memberAccountId: memberAccount,
  });

  const voteCliCmd = generateVoteCliCommand({
    panelDao,
    proposalId: "<PROPOSAL_ID>",
    memberAccountId: memberAccount,
  });

  return h(
    "main",
    { className: "min-h-screen bg-black text-neutral-200 px-4 py-8" },
    h(
      "div",
      { className: "max-w-4xl mx-auto space-y-8" },
      // Header
      h(
        "div",
        null,
        h(Link, { href: "/", className: "text-xs text-sky-400 hover:underline" }, "← Home"),
        h(
          "div",
          { className: "flex items-center justify-between mt-2" },
          h(
            "div",
            null,
            h("h1", { className: "text-2xl font-bold text-white" }, "Panel Review & Governance"),
            h(
              "p",
              { className: "text-xs text-neutral-400 mt-1" },
              "Triage submitted tips, decrypt evidence locally, and sponsor Sputnik DAO resolution proposals.",
            ),
          ),
          h(
            "div",
            { className: "text-xs font-mono px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 text-neutral-300" },
            `Contract: ${contractId}`,
          ),
        ),
      ),

      // 1. Credentials Section
      h(
        "div",
        { className: "rounded-lg border border-neutral-800 bg-neutral-900/60 p-5 space-y-4" },
        h("h2", { className: "text-sm font-semibold text-white uppercase tracking-wider" }, "1. Panel Member Credentials"),
        h(
          "div",
          { className: "grid grid-cols-1 md:grid-cols-2 gap-4" },
          h(
            "div",
            null,
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "Panel Member Account ID ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h("input", {
              type: "text",
              value: memberAccount,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setMemberAccount(e.target.value),
              placeholder: "e.g. panel1.testnet",
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-sky-500",
            }),
          ),
          h(
            "div",
            null,
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "X25519 Private Key (Hex or Base64) ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h("input", {
              type: "password",
              value: privateKeyInput,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPrivateKeyInput(e.target.value),
              placeholder: "32 bytes hex (64 chars) or base64",
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-sky-500",
            }),
          ),
        ),
      ),

      // 2. Tip Selection
      h(
        "div",
        { className: "rounded-lg border border-neutral-800 bg-neutral-900/60 p-5 space-y-4" },
        h("h2", { className: "text-sm font-semibold text-white uppercase tracking-wider" }, "2. Tip Inspection"),
        h(
          "div",
          { className: "flex gap-3 items-end" },
          h(
            "div",
            { className: "flex-1 max-w-xs" },
            h("label", { className: "block text-xs font-medium text-neutral-300 mb-1" }, "Tip ID to Inspect"),
            h("input", {
              type: "number",
              min: "0",
              value: tipIdInput,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTipIdInput(e.target.value),
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500",
            }),
          ),
          h(
            "button",
            {
              type: "button",
              onClick: handleFetchTip,
              disabled: loadingTip,
              className:
                "px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-800 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer",
            },
            loadingTip ? "Fetching On-Chain..." : "Fetch Tip Details",
          ),
        ),

        tipError &&
          h("div", { className: "text-xs text-red-400 bg-red-950/30 p-3 rounded-lg border border-red-800/40" }, tipError),

        tip &&
          h(
            "div",
            { className: "mt-4 pt-4 border-t border-neutral-800/80 space-y-3" },
            h(
              "div",
              { className: "flex flex-wrap items-center gap-4 text-xs font-mono" },
              h("span", { className: "text-white font-semibold" }, `Tip #${tip.id}`),
              h("span", { className: "text-neutral-400" }, `Programme: #${tip.programme_id}`),
              h(
                "span",
                { className: "text-neutral-400" },
                "Status: ",
                h(
                  "span",
                  { className: "text-sky-400 font-semibold" },
                  typeof tip.status === "string" ? tip.status : JSON.stringify(tip.status),
                ),
              ),
              h(
                "span",
                { className: "text-neutral-400" },
                `Recused: ${tip.recused.length > 0 ? tip.recused.join(", ") : "None"}`,
              ),
              h("span", { className: "text-neutral-400" }, `Sealed Keys: ${tip.sealed_keys.length}`),
            ),

            // Prominent red recusal alert banner
            recused
              ? h(
                  "div",
                  {
                    role: "alert",
                    className:
                      "rounded-lg border-2 border-red-600 bg-red-950/60 p-4 text-red-200 text-sm font-semibold flex items-start gap-3 shadow-lg",
                  },
                  h("span", { className: "text-xl" }, "⛔"),
                  h(
                    "div",
                    null,
                    h("div", { className: "font-bold text-red-100" }, "RECUSAL SAFETY ENFORCEMENT"),
                    h("div", { className: "mt-1 font-normal text-red-200" }, RECUSAL_ALERT_MESSAGE),
                  ),
                )
              : h(
                  "div",
                  { className: "pt-2" },
                  h(
                    "button",
                    {
                      type: "button",
                      onClick: handleDecrypt,
                      disabled: decrypting || !privateKeyInput.trim(),
                      className:
                        "px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer",
                    },
                    decrypting ? "Decrypting Evidence..." : "🔓 Decrypt Evidence Exhibit",
                  ),
                  !privateKeyInput.trim() &&
                    h("span", { className: "ml-3 text-[11px] text-neutral-500" }, "Enter your X25519 private key above to decrypt."),
                ),

            decryptError &&
              h("div", { className: "text-xs text-red-400 bg-red-950/30 p-3 rounded-lg border border-red-800/40" }, decryptError),
          ),
      ),

      // 3. Decrypted Exhibit Review
      bundle &&
        h(
          "div",
          { className: "rounded-lg border border-emerald-900/50 bg-emerald-950/10 p-5 space-y-6" },
          h(
            "div",
            { className: "flex items-center justify-between border-b border-emerald-900/40 pb-3" },
            h(
              "h2",
              { className: "text-sm font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2" },
              h("span", null, "📁"),
              " Decrypted Evidence Exhibit",
            ),
            h("span", { className: "text-xs font-mono text-emerald-500" }, "Plaintext Verified in Browser"),
          ),
          h(
            "div",
            { className: "space-y-2" },
            h("h3", { className: "text-base font-bold text-white" }, bundle.title),
            h(
              "div",
              {
                className:
                  "bg-neutral-950/90 rounded-lg p-4 border border-neutral-800 text-xs text-neutral-200 whitespace-pre-wrap font-sans leading-relaxed",
              },
              bundle.description,
            ),
          ),
          h("div", { className: "space-y-2" }, h(CleaningReportViewInline, { report: bundle.report })),
          h(
            "div",
            { className: "space-y-3" },
            h("h3", { className: "text-xs font-semibold text-neutral-300 uppercase tracking-wider" }, `Attached Files (${bundle.files.length})`),
            bundle.files.length === 0
              ? h("p", { className: "text-xs text-neutral-500" }, "No files attached to this tip.")
              : h(
                  "div",
                  { className: "grid grid-cols-1 md:grid-cols-2 gap-3" },
                  bundle.files.map((file, idx) => {
                    const estimatedBytes = Math.round(file.data.length * 0.75);
                    const formattedSize =
                      estimatedBytes < 1024 * 1024
                        ? `${(estimatedBytes / 1024).toFixed(1)} KB`
                        : `${(estimatedBytes / (1024 * 1024)).toFixed(2)} MB`;
                    const dataUrl = `data:${file.mime};base64,${file.data}`;

                    return h(
                      "div",
                      {
                        key: idx,
                        className: "rounded-lg bg-neutral-950 border border-neutral-800 p-3 flex flex-col justify-between space-y-2",
                      },
                      h(
                        "div",
                        null,
                        h("div", { className: "text-xs font-medium text-white truncate", title: file.name }, file.name),
                        h("div", { className: "text-[11px] font-mono text-neutral-400 mt-0.5" }, `${file.mime} • ${formattedSize}`),
                      ),
                      h(
                        "div",
                        { className: "flex gap-2 pt-2 border-t border-neutral-800/80" },
                        h(
                          "button",
                          {
                            type: "button",
                            onClick: () => setPreviewFile({ name: file.name, mime: file.mime, dataUrl }),
                            className: "text-xs px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-sky-400 font-medium cursor-pointer",
                          },
                          "Preview",
                        ),
                        h(
                          "a",
                          {
                            href: dataUrl,
                            download: file.name,
                            className: "text-xs px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-emerald-400 font-medium",
                          },
                          "Download",
                        ),
                      ),
                    );
                  }),
                ),
          ),
          bundle.redaction &&
            h(
              "div",
              { className: "space-y-3 pt-2" },
              h("h3", { className: "text-xs font-semibold text-sky-400 uppercase tracking-wider" }, "Intel TDX AI Redaction Record"),
              h(AttestationPanelInline, {
                bundleHash: tip?.attestation_hash ? toHex(tip.attestation_hash) : "Verified in Enclave",
                model: bundle.redaction.model,
                nonce: bundle.redaction.nonce,
              }),
              bundle.redaction.suggestions.length > 0 &&
                h(
                  "div",
                  { className: "rounded-lg bg-neutral-950 border border-sky-900/30 p-3 space-y-2 text-xs" },
                  h("div", { className: "font-semibold text-neutral-300" }, "Enclave Redaction Suggestions Applied:"),
                  h(
                    "ul",
                    { className: "space-y-1 list-disc list-inside text-neutral-400 text-[11px]" },
                    bundle.redaction.suggestions.map((s, idx) =>
                      h(
                        "li",
                        { key: idx },
                        h("span", { className: "text-red-400 font-mono" }, `"${s.span}"`),
                        " → ",
                        h("span", { className: "text-emerald-400 font-mono" }, `"${s.replacement}"`),
                        ` (${s.reason})`,
                      ),
                    ),
                  ),
                ),
            ),
        ),

      // 4. Member Triage Controls
      tip &&
        !recused &&
        h(
          "div",
          { className: "rounded-lg border border-neutral-800 bg-neutral-900/60 p-5 space-y-4" },
          h(
            "div",
            { className: "flex items-center justify-between" },
            h("h2", { className: "text-sm font-semibold text-white uppercase tracking-wider" }, "3. Member Triage Actions"),
            h("span", { className: "text-xs text-neutral-400" }, "Direct panel member call"),
          ),
          h(
            "p",
            { className: "text-xs text-neutral-400" },
            "Any non-recused panel member can call ",
            h("code", { className: "text-neutral-300 font-mono" }, "triage"),
            " to mark a submitted tip as credible (locking escrow funds into review) or dismissed.",
          ),
          h(
            "div",
            { className: "grid grid-cols-1 gap-3" },
            h(
              "div",
              { className: "rounded bg-neutral-950 p-3 border border-neutral-800" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-emerald-400" }, "Mark as Credible"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(triageCredibleCmd, "credible"),
                    className: "text-[11px] text-sky-400 hover:text-sky-300 cursor-pointer",
                  },
                  copiedKey === "credible" ? "Copied!" : "Copy Command",
                ),
              ),
              h("pre", { className: "text-[11px] font-mono text-neutral-300 overflow-x-auto p-2 bg-black/60 rounded" }, triageCredibleCmd),
            ),
            h(
              "div",
              { className: "rounded bg-neutral-950 p-3 border border-neutral-800" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-amber-400" }, "Dismiss Tip"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(triageDismissCmd, "dismiss"),
                    className: "text-[11px] text-sky-400 hover:text-sky-300 cursor-pointer",
                  },
                  copiedKey === "dismiss" ? "Copied!" : "Copy Command",
                ),
              ),
              h("pre", { className: "text-[11px] font-mono text-neutral-300 overflow-x-auto p-2 bg-black/60 rounded" }, triageDismissCmd),
            ),
          ),
        ),

      // 5. Sputnik DAO Resolution Generator
      tip &&
        !recused &&
        h(
          "div",
          { className: "rounded-lg border border-neutral-800 bg-neutral-900/60 p-5 space-y-4" },
          h(
            "div",
            { className: "flex items-center justify-between" },
            h("h2", { className: "text-sm font-semibold text-white uppercase tracking-wider" }, "4. Sputnik DAO Resolution Generator"),
            h("span", { className: "text-xs font-mono text-purple-400" }, "Sputnik v2.0.0 Proposal"),
          ),
          h(
            "p",
            { className: "text-xs text-neutral-400" },
            "Final resolution (",
            h("code", { className: "text-neutral-300 font-mono" }, "resolve_tip"),
            ") can ONLY be executed by the Programme's Sputnik DAO council (",
            h("code", { className: "text-neutral-300 font-mono" }, panelDao),
            ").",
          ),
          h(
            "div",
            { className: "grid grid-cols-1 md:grid-cols-2 gap-4 pt-2" },
            h(
              "div",
              null,
              h("label", { className: "block text-xs font-medium text-neutral-300 mb-1" }, "Proposed Outcome"),
              h(
                "div",
                { className: "flex gap-4 mt-1" },
                h(
                  "label",
                  { className: "flex items-center gap-2 text-xs text-neutral-200 cursor-pointer" },
                  h("input", {
                    type: "radio",
                    name: "outcome",
                    value: "Accept",
                    checked: voteOutcome === "Accept",
                    onChange: () => setVoteOutcome("Accept"),
                    className: "accent-emerald-500",
                  }),
                  h("span", { className: "text-emerald-400 font-medium" }, "Accept Tip"),
                ),
                h(
                  "label",
                  { className: "flex items-center gap-2 text-xs text-neutral-200 cursor-pointer" },
                  h("input", {
                    type: "radio",
                    name: "outcome",
                    value: "Reject",
                    checked: voteOutcome === "Reject",
                    onChange: () => setVoteOutcome("Reject"),
                    className: "accent-red-500",
                  }),
                  h("span", { className: "text-red-400 font-medium" }, "Reject Tip"),
                ),
              ),
            ),
            voteOutcome === "Accept" &&
              h(
                "div",
                null,
                h("label", { className: "block text-xs font-medium text-neutral-300 mb-1" }, "Reward Amount (USDC)"),
                h("input", {
                  type: "number",
                  min: "1",
                  step: "1",
                  value: rewardUsdc,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRewardUsdc(e.target.value),
                  className:
                    "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500",
                }),
                h(
                  "p",
                  { className: "text-[11px] text-neutral-500 mt-1" },
                  `Base units: ${BigInt(Math.round(Number(rewardUsdc) * 1_000_000)).toString()}`,
                ),
              ),
          ),
          h(
            "div",
            { className: "space-y-3 pt-3" },
            h(
              "div",
              { className: "rounded bg-neutral-950 p-3 border border-neutral-800" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-neutral-300" }, "Sputnik DAO Proposal JSON (Proposal bond: 0.1 NEAR)"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(JSON.stringify(proposalData.proposal, null, 2), "proposalJson"),
                    className: "text-[11px] text-sky-400 hover:text-sky-300 cursor-pointer",
                  },
                  copiedKey === "proposalJson" ? "Copied!" : "Copy JSON",
                ),
              ),
              h(
                "pre",
                { className: "text-[11px] font-mono text-neutral-300 overflow-x-auto p-2 bg-black/60 rounded max-h-48" },
                JSON.stringify(proposalData.proposal, null, 2),
              ),
            ),
            h(
              "div",
              { className: "rounded bg-neutral-950 p-3 border border-neutral-800" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-purple-400" }, "1. Create Proposal CLI Command"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(proposalCliCmd, "proposeCmd"),
                    className: "text-[11px] text-sky-400 hover:text-sky-300 cursor-pointer",
                  },
                  copiedKey === "proposeCmd" ? "Copied!" : "Copy Command",
                ),
              ),
              h("pre", { className: "text-[11px] font-mono text-neutral-300 overflow-x-auto p-2 bg-black/60 rounded" }, proposalCliCmd),
            ),
            h(
              "div",
              { className: "rounded bg-neutral-950 p-3 border border-neutral-800" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-purple-400" }, "2. Vote Approve CLI Command"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(voteCliCmd, "voteCmd"),
                    className: "text-[11px] text-sky-400 hover:text-sky-300 cursor-pointer",
                  },
                  copiedKey === "voteCmd" ? "Copied!" : "Copy Command",
                ),
              ),
              h("pre", { className: "text-[11px] font-mono text-neutral-300 overflow-x-auto p-2 bg-black/60 rounded" }, voteCliCmd),
              h(
                "p",
                { className: "text-[11px] text-neutral-500 mt-1" },
                "Replace ",
                h("code", { className: "text-neutral-400" }, "<PROPOSAL_ID>"),
                " with the ID returned by ",
                h("code", { className: "text-neutral-400" }, "add_proposal"),
                ".",
              ),
            ),
          ),
        ),

      // 6. Preview Modal
      previewFile &&
        h(
          "div",
          { className: "fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" },
          h(
            "div",
            { className: "bg-neutral-900 border border-neutral-700 rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col p-4 space-y-4" },
            h(
              "div",
              { className: "flex justify-between items-center" },
              h("h3", { className: "text-sm font-semibold text-white truncate" }, previewFile.name),
              h(
                "button",
                {
                  type: "button",
                  onClick: () => setPreviewFile(null),
                  className: "text-neutral-400 hover:text-white text-lg font-bold cursor-pointer",
                },
                "✕",
              ),
            ),
            h(
              "div",
              { className: "flex-1 overflow-auto bg-black rounded p-2 flex items-center justify-center min-h-[300px]" },
              previewFile.mime.startsWith("image/")
                ? h("img", {
                    src: previewFile.dataUrl,
                    alt: previewFile.name,
                    className: "max-h-[60vh] max-w-full object-contain",
                  })
                : h("iframe", { src: previewFile.dataUrl, title: previewFile.name, className: "w-full h-[60vh] border-0" }),
            ),
            h(
              "div",
              { className: "flex justify-end" },
              h(
                "a",
                {
                  href: previewFile.dataUrl,
                  download: previewFile.name,
                  className: "px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium",
                },
                "Download File",
              ),
            ),
          ),
        ),
    ),
  );
}
