"use client";

import React, { useEffect, useState } from "react";
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
import { AttestationPanel } from "../../components/AttestationPanel";
import { CleaningReportView } from "../../components/CleaningReportView";
import { publicConfig, type PublicConfig } from "../../lib/config";

const h = React.createElement;

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
        rpcUrl: "https://rpc.testnet.fastnear.com",
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
    "div",
    { className: "mx-auto w-full max-w-4xl px-4 py-10 sm:px-6" },
    h(
      "div",
      { className: "card on-paper space-y-8 p-5 sm:p-8" },
      h(
        "div",
        { className: "space-y-3" },
        h("h1", { className: "display text-[clamp(1.75rem,5vw,2.25rem)] text-ask" }, "Panel review"),
        h(
          "p",
          { className: "text-sm leading-relaxed text-ink-muted" },
          "Unseal an evidence bundle in your own browser, vote on credibility, and sponsor the DAO proposal that pays the bounty.",
        ),
        h("p", { className: "datum text-xs text-ink-muted" }, `Contract ${contractId}`),
      ),

      // 1. Credentials Section
      h(
        "div",
        { className: "card-inset p-5 space-y-4" },
        h("h2", { className: "text-sm font-semibold text-ink" }, "1. Panel Member Credentials"),
        h(
          "div",
          { className: "grid grid-cols-1 md:grid-cols-2 gap-4" },
          h(
            "div",
            null,
            h(
              "label",
              { className: "block text-xs font-medium text-ink-muted mb-1" },
              "Panel member account ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h("input", {
              id: "panel-member-account",
              type: "text",
              value: memberAccount,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setMemberAccount(e.target.value),
              placeholder: "e.g. panel1.testnet",
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink placeholder:text-ink-muted ",
            }),
          ),
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "panel-private-key", className: "block text-xs font-medium text-ink-muted mb-1" },
              "X25519 Private Key (Hex or Base64) ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h("input", {
              id: "panel-private-key",
              type: "password",
              value: privateKeyInput,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPrivateKeyInput(e.target.value),
              placeholder: "32 bytes hex (64 chars) or base64",
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink placeholder:text-ink-muted ",
            }),
          ),
        ),
      ),

      // 2. Tip Selection
      h(
        "div",
        { className: "card-inset p-5 space-y-4" },
        h("h2", { className: "text-sm font-semibold text-ink" }, "2. Tip Inspection"),
        h(
          "div",
          { className: "flex flex-col sm:flex-row gap-3 sm:items-end" },
          h(
            "div",
            { className: "flex-1 max-w-xs" },
            h("label", { htmlFor: "tip-id-inspect", className: "block text-xs font-medium text-ink-muted mb-1" }, "Tip ID to Inspect"),
            h("input", {
              id: "tip-id-inspect",
              type: "number",
              min: "0",
              value: tipIdInput,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTipIdInput(e.target.value),
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink ",
            }),
          ),
          h(
            "button",
            {
              type: "button",
              onClick: handleFetchTip,
              disabled: loadingTip,
              className:
                "btn-primary shrink-0 px-5 text-xs disabled:cursor-not-allowed disabled:opacity-40",
            },
            loadingTip ? "Fetching from the chain…" : "Fetch tip",
          ),
        ),

        tipError &&
          h("div", { className: "text-xs text-bad p-3 card-inset border-l-4 border-l-bad" }, tipError),

        tip &&
          h(
            "div",
            { className: "mt-4 pt-4 border-t border-rule space-y-3" },
            h(
              "div",
              { className: "flex flex-wrap items-center gap-4 text-xs font-mono" },
              h("span", { className: "text-ink font-semibold" }, `Tip #${tip.id}`),
              h("span", { className: "text-ink-muted" }, `Programme: #${tip.programme_id}`),
              h(
                "span",
                { className: "text-ink-muted" },
                "Status: ",
                h(
                  "span",
                  { className: "text-ask font-semibold" },
                  typeof tip.status === "string" ? tip.status : JSON.stringify(tip.status),
                ),
              ),
              h(
                "span",
                { className: "text-ink-muted" },
                `Recused: ${tip.recused.length > 0 ? tip.recused.join(", ") : "None"}`,
              ),
              h("span", { className: "text-ink-muted" }, `Sealed Keys: ${tip.sealed_keys.length}`),
            ),

            // Prominent red recusal alert banner
            recused
              ? h(
                  "div",
                  {
                    role: "alert",
                    className:
                      "border-l-4 border-l-bad bg-paper p-4 text-sm text-bad",
                  },
                  h(
                    "div",
                    null,
                    h("h3", { className: "font-semibold text-ink" }, "You are recused from this tip"),
                    h("p", { className: "mt-1 text-bad" }, RECUSAL_ALERT_MESSAGE),
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
                        "btn-primary px-4 text-xs disabled:cursor-not-allowed disabled:opacity-40",
                    },
                    decrypting ? "Decrypting evidence…" : "Decrypt evidence exhibit",
                  ),
                  !privateKeyInput.trim() &&
                    h("span", { className: "ml-3 text-[11px] text-ink-muted" }, "Enter your X25519 private key above to decrypt."),
                ),

            decryptError &&
              h("p", { className: "border-l-4 border-l-bad bg-paper p-3 text-xs text-bad" }, decryptError),
          ),
      ),

      // 3. Decrypted Exhibit Review
      bundle &&
        h(
          "div",
          { className: "card-inset border-l-4 border-l-ok p-5 space-y-6" },
          h(
            "div",
            { className: "flex items-center justify-between border-b border-ok pb-3" },
            h(
              "h2",
              { className: "text-sm font-semibold text-ok flex items-center gap-2" },
              h("span", null, "📁"),
              " Decrypted Evidence Exhibit",
            ),
            h("span", { className: "text-xs font-mono text-ok" }, "Plaintext Verified in Browser"),
          ),
          h(
            "div",
            { className: "space-y-2" },
            h("h3", { className: "text-base font-semibold text-ink" }, bundle.title),
            h(
              "div",
              {
                className:
                  "bg-paper-2 rounded-field p-4 border border-rule text-xs text-ink whitespace-pre-wrap font-text leading-relaxed",
              },
              bundle.description,
            ),
          ),
          h(CleaningReportView, { report: bundle.report }),
          h(
            "div",
            { className: "space-y-3" },
            h("h3", { className: "text-xs font-semibold text-ink-muted" }, `Attached Files (${bundle.files.length})`),
            bundle.files.length === 0
              ? h("p", { className: "text-xs text-ink-muted" }, "No files attached to this tip.")
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
                        className: "card-inset p-3 flex flex-col justify-between space-y-2",
                      },
                      h(
                        "div",
                        null,
                        h("div", { className: "text-xs font-medium text-ink truncate", title: file.name }, file.name),
                        h("div", { className: "text-[11px] font-mono text-ink-muted mt-0.5" }, `${file.mime}, ${formattedSize}`),
                      ),
                      h(
                        "div",
                        { className: "flex gap-2 pt-2 border-t border-rule" },
                        h(
                          "button",
                          {
                            type: "button",
                            onClick: () => setPreviewFile({ name: file.name, mime: file.mime, dataUrl }),
                            className: "btn-secondary px-3.5 text-xs",
                          },
                          "Preview",
                        ),
                        h(
                          "a",
                          {
                            href: dataUrl,
                            download: file.name,
                            className: "btn-secondary px-3.5 text-xs no-underline",
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
              tip?.attestation_hash
                ? h(AttestationPanel, {
                    bundleHash: toHex(tip.attestation_hash),
                    model: bundle.redaction.model,
                    nonce: bundle.redaction.nonce,
                  })
                : h(
                    "p",
                    { className: "border-l-4 border-l-warn bg-paper p-3 text-xs text-ink-muted" },
                    "This tip carries no attestation hash, so the enclave report in it is not verified against the chain. Read the replacements below on that basis.",
                  ),
              bundle.redaction.suggestions.length > 0 &&
                h(
                  "div",
                  { className: "card-inset border-l-4 border-l-ask p-3 space-y-2 text-xs" },
                  h("h4", { className: "text-sm font-semibold text-ink" }, "What the enclave changed"),
                  h(
                    "ul",
                    { className: "divide-y divide-rule text-xs" },
                    bundle.redaction.suggestions.map((s, idx) =>
                      h(
                        "li",
                        { key: idx, className: "py-2" },
                        h("span", { className: "datum break-all text-ink-muted line-through" }, s.span),
                        " → ",
                        h("span", { className: "datum break-all font-semibold text-ink" }, s.replacement),
                        h("p", { className: "mt-1 text-[11px] text-ink-muted" }, s.reason),
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
          { className: "card-inset p-5 space-y-4" },
          h(
            "div",
            { className: "flex items-center justify-between" },
            h("h2", { className: "text-sm font-semibold text-ink" }, "3. Member Triage Actions"),
            h("span", { className: "text-xs text-ink-muted" }, "Direct panel member call"),
          ),
          h(
            "p",
            { className: "text-xs text-ink-muted" },
            "Any non-recused panel member can call ",
            h("code", { className: "text-ink-muted font-mono" }, "triage"),
            " to mark a submitted tip as credible (locking escrow funds into review) or dismissed.",
          ),
          h(
            "div",
            { className: "grid grid-cols-1 gap-3" },
            h(
              "div",
              { className: "card-inset p-3" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-ok" }, "Mark as Credible"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(triageCredibleCmd, "credible"),
                    className: "text-[11px] text-ask hover:text-ask cursor-pointer",
                  },
                  copiedKey === "credible" ? "Copied!" : "Copy command",
                ),
              ),
              h("pre", { className: "datum overflow-x-auto rounded-field bg-paper-3 p-3 text-[11px] text-ink-muted" }, triageCredibleCmd),
            ),
            h(
              "div",
              { className: "card-inset p-3" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-warn" }, "Dismiss tip"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(triageDismissCmd, "dismiss"),
                    className: "text-[11px] text-ask hover:text-ask cursor-pointer",
                  },
                  copiedKey === "dismiss" ? "Copied!" : "Copy command",
                ),
              ),
              h("pre", { className: "text-[11px] font-mono text-ink-muted overflow-x-auto p-2 bg-paper-3 rounded-inset" }, triageDismissCmd),
            ),
          ),
        ),

      // 5. Sputnik DAO Resolution Generator
      tip &&
        !recused &&
        h(
          "div",
          { className: "card-inset p-5 space-y-4" },
          h(
            "div",
            { className: "flex items-center justify-between" },
            h("h2", { className: "text-sm font-semibold text-ink" }, "4. Sputnik DAO Resolution Generator"),
            h("span", { className: "text-xs font-mono text-ask" }, "Sputnik v2.0.0 Proposal"),
          ),
          h(
            "p",
            { className: "text-xs text-ink-muted" },
            "Final resolution (",
            h("code", { className: "text-ink-muted font-mono" }, "resolve_tip"),
            ") can ONLY be executed by the Programme's Sputnik DAO council (",
            h("code", { className: "text-ink-muted font-mono" }, panelDao),
            ").",
          ),
          h(
            "div",
            { className: "grid grid-cols-1 md:grid-cols-2 gap-4 pt-2" },
            h(
              "div",
              null,
              h("label", { className: "block text-xs font-medium text-ink-muted mb-1" }, "Proposed outcome"),
              h(
                "div",
                { className: "flex gap-4 mt-1" },
                h(
                  "label",
                  { className: "flex items-center gap-2 text-xs text-ink cursor-pointer" },
                  h("input", {
                    type: "radio",
                    name: "outcome",
                    value: "Accept",
                    checked: voteOutcome === "Accept",
                    onChange: () => setVoteOutcome("Accept"),
                    className: "accent-ok",
                  }),
                  h("span", { className: "text-ok font-medium" }, "Accept tip"),
                ),
                h(
                  "label",
                  { className: "flex items-center gap-2 text-xs text-ink cursor-pointer" },
                  h("input", {
                    type: "radio",
                    name: "outcome",
                    value: "Reject",
                    checked: voteOutcome === "Reject",
                    onChange: () => setVoteOutcome("Reject"),
                    className: "accent-bad",
                  }),
                  h("span", { className: "text-bad font-medium" }, "Reject tip"),
                ),
              ),
            ),
            voteOutcome === "Accept" &&
              h(
                "div",
                null,
                h("label", { className: "block text-xs font-medium text-ink-muted mb-1" }, "Reward (USDC)"),
                h("input", {
                  type: "number",
                  min: "1",
                  step: "1",
                  value: rewardUsdc,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRewardUsdc(e.target.value),
                  className:
                  "w-full bg-paper border border-edge rounded-field px-3 py-2 text-xs font-mono text-ink ",
                }),
                h(
                  "p",
                  { className: "text-[11px] text-ink-muted mt-1" },
                  `Base units: ${BigInt(Math.round(Number(rewardUsdc) * 1_000_000)).toString()}`,
                ),
              ),
          ),
          h(
            "div",
            { className: "space-y-3 pt-3" },
            h(
              "div",
              { className: "card-inset p-3" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-ink-muted" }, "Sputnik DAO Proposal JSON (Proposal bond: 0.1 NEAR)"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(JSON.stringify(proposalData.proposal, null, 2), "proposalJson"),
                    className: "text-[11px] text-ask hover:text-ask cursor-pointer",
                  },
                  copiedKey === "proposalJson" ? "Copied!" : "Copy JSON",
                ),
              ),
              h(
                "pre",
                { className: "text-[11px] font-mono text-ink-muted overflow-x-auto p-2 bg-paper-3 rounded-inset max-h-48" },
                JSON.stringify(proposalData.proposal, null, 2),
              ),
            ),
            h(
              "div",
              { className: "card-inset p-3" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-ask" }, "1. Create Proposal CLI Command"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(proposalCliCmd, "proposeCmd"),
                    className: "text-[11px] text-ask hover:text-ask cursor-pointer",
                  },
                  copiedKey === "proposeCmd" ? "Copied!" : "Copy command",
                ),
              ),
              h("pre", { className: "text-[11px] font-mono text-ink-muted overflow-x-auto p-2 bg-paper-3 rounded-inset" }, proposalCliCmd),
            ),
            h(
              "div",
              { className: "card-inset p-3" },
              h(
                "div",
                { className: "flex justify-between items-center mb-1" },
                h("span", { className: "text-xs font-semibold text-ask" }, "2. Vote Approve CLI Command"),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => copyToClipboard(voteCliCmd, "voteCmd"),
                    className: "text-[11px] text-ask hover:text-ask cursor-pointer",
                  },
                  copiedKey === "voteCmd" ? "Copied!" : "Copy command",
                ),
              ),
              h("pre", { className: "text-[11px] font-mono text-ink-muted overflow-x-auto p-2 bg-paper-3 rounded-inset" }, voteCliCmd),
              h(
                "p",
                { className: "text-[11px] text-ink-muted mt-1" },
                "Replace ",
                h("code", { className: "text-ink-muted" }, "<PROPOSAL_ID>"),
                " with the ID returned by ",
                h("code", { className: "text-ink-muted" }, "add_proposal"),
                ".",
              ),
            ),
          ),
        ),

      // 6. Preview Modal
      previewFile &&
        h(
          "div",
          { className: "fixed inset-0 z-50 flex items-end justify-center bg-ground-2/80 p-0 sm:items-center sm:p-4",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": `Exhibit preview: ${previewFile.name}` },
          h(
            "div",
            { className: "card flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 p-4 sm:p-5" },
            h(
              "div",
              { className: "flex justify-between items-center" },
              h("h3", { className: "text-sm font-semibold text-ink truncate" }, previewFile.name),
              h(
                "button",
                {
                  type: "button",
                  onClick: () => setPreviewFile(null),
                  "aria-label": "Close exhibit preview",
                  className: "btn-secondary min-w-[44px] px-3 text-xs",
                },
                "Close",
              ),
            ),
            h(
              "div",
              { className: "flex min-h-[300px] flex-1 items-center justify-center overflow-auto rounded-field bg-paper-3 p-2" },
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
                  className: "btn-primary px-4 text-xs",
                },
                "Download this exhibit",
              ),
            ),
          ),
        ),
    ),
  );
}
