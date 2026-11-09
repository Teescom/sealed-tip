"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { publicConfig, type PublicConfig } from "../../../lib/config";

const h = React.createElement;

export const RESERVE_ON_TRIAGE_GUARANTEE = {
  title: "Reserve-on-Triage Security Guarantee",
  points: [
    {
      heading: "Zero Capital Locked at Submission",
      detail:
        "Submitting an anonymous tip costs zero escrowed reward funds. Spam or frivolous submissions cannot freeze or lock funder capital.",
    },
    {
      heading: "Strict Reservation at Triage",
      detail:
        "Only when a legitimate, appointed panel member marks a tip as credible during triage is exactly max_reward reserved from the programme balance.",
    },
    {
      heading: "Funder Capital Always Safe & Withdrawable",
      detail:
        "Funders retain sovereign control of unreserved capital (balance − reserved) and can withdraw anytime via withdraw_unreserved.",
    },
    {
      heading: "Instant Release on Rejection or Resolution",
      detail:
        "If a tip is dismissed, rejected by the Sputnik DAO, or resolved with a reward below max_reward, unspent reserved funds return immediately to the withdrawable pool.",
    },
  ],
};

export function usdcToUnits(usdc: number | string): string {
  const num = typeof usdc === "number" ? usdc : parseFloat(usdc) || 0;
  return BigInt(Math.round(num * 1_000_000)).toString();
}

export function nearToYocto(near: number | string): string {
  const num = typeof near === "number" ? near : parseFloat(near) || 0;
  // 1 NEAR = 10^24 yoctoNEAR
  return (BigInt(Math.round(num * 1_000_000)) * 10n ** 18n).toString();
}

export async function computeScopeHash(scope: string): Promise<number[]> {
  const trimmed = scope.trim();
  if (!trimmed) {
    return new Array(32).fill(0);
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(trimmed);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer));
}

export interface ProgrammeFormParams {
  contractId: string;
  funderAccountId: string;
  title: string;
  scopeUri: string;
  scopeDescription: string;
  maxRewardUSDC: number | string;
  opsDepositNear: number | string;
  panelDao: string;
  tokenContract: string;
  timeScale: number;
  initialFundUSDC?: number | string | undefined;
  powBits?: number | undefined;
  gasDripNear?: number | string | undefined;
}

export interface GeneratedCommandsResult {
  createArgs: {
    title: string;
    scope_uri: string;
    scope_hash: number[];
    panel_dao: string;
    token: string;
    max_reward: string;
    gas_drip: string;
    pow_bits: number;
    time_scale: number;
  };
  createCommand: string;
  initProgrammeCommand: string;
  fundCommand: string;
  topUpCommand: string;
}

export async function generateProgrammeCommands(
  params: ProgrammeFormParams,
): Promise<GeneratedCommandsResult> {
  const scopeTextToHash = params.scopeDescription || params.scopeUri;
  const scopeHash = await computeScopeHash(scopeTextToHash);
  const maxRewardUnits = usdcToUnits(params.maxRewardUSDC);
  const initialFundUnits = usdcToUnits(params.initialFundUSDC ?? params.maxRewardUSDC);
  const powBits = params.powBits ?? 12;
  const gasDripYocto = nearToYocto(params.gasDripNear ?? 0.05);

  const createArgs = {
    title: params.title,
    scope_uri: params.scopeUri,
    scope_hash: scopeHash,
    panel_dao: params.panelDao,
    token: params.tokenContract,
    max_reward: maxRewardUnits,
    gas_drip: gasDripYocto,
    pow_bits: powBits,
    time_scale: params.timeScale,
  };

  const argsJson = JSON.stringify(createArgs);
  const depositNear = params.opsDepositNear.toString();

  // Primary contract method: create_programme
  const createCommand = `near call ${params.contractId} create_programme '${argsJson}' --accountId ${params.funderAccountId} --deposit ${depositNear} --gas 100000000000000`;

  // Explicit init_programme alias command for compatibility
  const initProgrammeCommand = `near call ${params.contractId} init_programme '${argsJson}' --accountId ${params.funderAccountId} --deposit ${depositNear} --gas 100000000000000`;

  // NEP-141 token ft_transfer_call with {"fund": <programme_id>}
  const fundArgs = {
    receiver_id: params.contractId,
    amount: initialFundUnits,
    memo: `Initial funding for programme`,
    msg: `{"fund":<PROGRAMME_ID>}`,
  };
  const fundCommand = `near call ${params.tokenContract} ft_transfer_call '${JSON.stringify(fundArgs)}' --accountId ${params.funderAccountId} --depositYocto 1 --gas 100000000000000`;

  // Ops balance top up instructions
  const topUpCommand = `# Note: Initial ops_balance is funded via the --deposit attached to create_programme (${depositNear} NEAR).
# To top up operational balance for destination storage deposits & gas drips later:
near call ${params.contractId} top_up_ops '{"programme_id": <PROGRAMME_ID>}' --accountId ${params.funderAccountId} --deposit 2 --gas 50000000000000`;

  return {
    createArgs,
    createCommand,
    initProgrammeCommand,
    fundCommand,
    topUpCommand,
  };
}

export default function NewProgrammePage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);

  // Form Fields
  const [title, setTitle] = useState("Public Procurement Whistleblower Programme");
  const [scopeUri, setScopeUri] = useState("https://example.org/procurement-rules.pdf");
  const [scopeDescription, setScopeDescription] = useState(
    "Report bid-rigging, kickbacks, and unauthorized contract modifications in public procurement.",
  );
  const [maxRewardUsdc, setMaxRewardUsdc] = useState("5000");
  const [initialFundUsdc, setInitialFundUsdc] = useState("10000");
  const [opsDepositNear, setOpsDepositNear] = useState("2");
  const [panelDao, setPanelDao] = useState("whistleblower-dao.sputnik-dao.near");
  const [tokenContract, setTokenContract] = useState("usdc.testnet");
  const [funderAccount, setFunderAccount] = useState("funder.testnet");
  const [timeScale, setTimeScale] = useState<number>(1);
  const [powBits, setPowBits] = useState<number>(12);

  // Generated Commands State
  const [commands, setCommands] = useState<GeneratedCommandsResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const res = publicConfig();
    if (res.ok) {
      setConfig(res.config);
      if (res.config.tokenContract) {
        setTokenContract(res.config.tokenContract);
      }
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

  useEffect(() => {
    const contractId = config?.contractId ?? "sealedtip.testnet";
    generateProgrammeCommands({
      contractId,
      funderAccountId: funderAccount,
      title,
      scopeUri,
      scopeDescription,
      maxRewardUSDC: maxRewardUsdc,
      opsDepositNear,
      panelDao,
      tokenContract,
      timeScale,
      initialFundUSDC: initialFundUsdc,
      powBits,
    }).then(setCommands);
  }, [
    config,
    funderAccount,
    title,
    scopeUri,
    scopeDescription,
    maxRewardUsdc,
    opsDepositNear,
    panelDao,
    tokenContract,
    timeScale,
    initialFundUsdc,
    powBits,
  ]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

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
            h("h1", { className: "text-2xl font-bold text-white" }, "Create New Programme"),
            h(
              "p",
              { className: "text-xs text-neutral-400 mt-1" },
              "Funder setup: initialize programme parameters, fund token reward pool, and delegate adjudication to a Sputnik DAO.",
            ),
          ),
          h(
            "div",
            { className: "text-xs font-mono px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 text-neutral-300" },
            `Contract: ${config?.contractId ?? "sealedtip.testnet"}`,
          ),
        ),
      ),

      // Security Guarantee Box
      h(
        "div",
        { className: "rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-5 space-y-3" },
        h(
          "div",
          { className: "flex items-center gap-2 text-emerald-400 font-semibold text-sm" },
          h("span", null, "🛡️"),
          " ",
          RESERVE_ON_TRIAGE_GUARANTEE.title,
        ),
        h(
          "div",
          { className: "grid grid-cols-1 md:grid-cols-2 gap-3 text-xs" },
          RESERVE_ON_TRIAGE_GUARANTEE.points.map((pt, idx) =>
            h(
              "div",
              { key: idx, className: "bg-black/40 rounded p-3 border border-emerald-900/30 space-y-1" },
              h("div", { className: "font-semibold text-emerald-300" }, pt.heading),
              h("div", { className: "text-neutral-300 text-[11px] leading-relaxed" }, pt.detail),
            ),
          ),
        ),
      ),

      // 1. Programme Configuration Form
      h(
        "div",
        { className: "rounded-lg border border-neutral-800 bg-neutral-900/60 p-5 space-y-5" },
        h("h2", { className: "text-sm font-semibold text-white uppercase tracking-wider" }, "1. Programme Configuration"),
        h(
          "div",
          { className: "grid grid-cols-1 md:grid-cols-2 gap-4" },
          // Title
          h(
            "div",
            { className: "md:col-span-2" },
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "Programme Title ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h("input", {
              type: "text",
              value: title,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value),
              placeholder: "e.g. Public Infrastructure Anti-Corruption Fund",
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-sky-500",
            }),
          ),

          // Scope URI
          h(
            "div",
            { className: "md:col-span-2" },
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "Scope URI (Rules, Boundaries & Policy Document) ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h("input", {
              type: "text",
              value: scopeUri,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setScopeUri(e.target.value),
              placeholder: "https://... or ipfs://...",
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-sky-500",
            }),
          ),

          // Scope Narrative
          h(
            "div",
            { className: "md:col-span-2" },
            h("label", { className: "block text-xs font-medium text-neutral-300 mb-1" }, "Whistleblower Scope Description"),
            h("textarea", {
              rows: 3,
              value: scopeDescription,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setScopeDescription(e.target.value),
              placeholder: "Describe reporting boundaries, required evidence, and terms...",
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-sky-500",
            }),
          ),

          // Max Reward
          h(
            "div",
            null,
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "Max Reward per Tip (USDC) ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h("input", {
              type: "number",
              min: "1",
              step: "1",
              value: maxRewardUsdc,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setMaxRewardUsdc(e.target.value),
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500",
            }),
            h("p", { className: "text-[11px] text-neutral-500 mt-0.5" }, `Base units (6 decimals): ${usdcToUnits(maxRewardUsdc)}`),
          ),

          // Initial Funding Pool
          h(
            "div",
            null,
            h("label", { className: "block text-xs font-medium text-neutral-300 mb-1" }, "Initial Reward Pool Funding (USDC)"),
            h("input", {
              type: "number",
              min: "1",
              step: "1",
              value: initialFundUsdc,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInitialFundUsdc(e.target.value),
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500",
            }),
            h("p", { className: "text-[11px] text-neutral-500 mt-0.5" }, `Total fund deposited via NEP-141: ${usdcToUnits(initialFundUsdc)}`),
          ),

          // Ops Balance Deposit
          h(
            "div",
            null,
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "Ops Balance Deposit (NEAR) ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h("input", {
              type: "number",
              min: "0.5",
              step: "0.5",
              value: opsDepositNear,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setOpsDepositNear(e.target.value),
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500",
            }),
            h("p", { className: "text-[11px] text-neutral-500 mt-0.5" }, "Covers gas drips (0.05 NEAR per payout) and NEP-141 destination storage deposits."),
          ),

          // Panel Sputnik DAO Account
          h(
            "div",
            null,
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "Panel Sputnik DAO Account ID ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h("input", {
              type: "text",
              value: panelDao,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPanelDao(e.target.value),
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500",
            }),
            h("p", { className: "text-[11px] text-neutral-500 mt-0.5" }, "Council responsible for appointing reviewers and voting on tip resolution."),
          ),

          // Token Account
          h(
            "div",
            null,
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "Reward Token Contract (NEP-141) ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h("input", {
              type: "text",
              value: tokenContract,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTokenContract(e.target.value),
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500",
            }),
          ),

          // Funder Account
          h(
            "div",
            null,
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "Funder Account ID ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h("input", {
              type: "text",
              value: funderAccount,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFunderAccount(e.target.value),
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500",
            }),
          ),

          // Time Scale
          h(
            "div",
            null,
            h(
              "label",
              { className: "block text-xs font-medium text-neutral-300 mb-1" },
              "Time Scale ",
              h("span", { className: "text-red-400" }, "*"),
            ),
            h(
              "div",
              { className: "flex gap-4 mt-2" },
              h(
                "label",
                { className: "flex items-center gap-2 text-xs cursor-pointer" },
                h("input", {
                  type: "radio",
                  name: "timeScale",
                  checked: timeScale === 1,
                  onChange: () => setTimeScale(1),
                  className: "accent-sky-500",
                }),
                h("span", null, "Production (1 — 1x real time)"),
              ),
              h(
                "label",
                { className: "flex items-center gap-2 text-xs cursor-pointer" },
                h("input", {
                  type: "radio",
                  name: "timeScale",
                  checked: timeScale === 1440,
                  onChange: () => setTimeScale(1440),
                  className: "accent-purple-500",
                }),
                h("span", null, "Demo/Testing (1440 — 1 day = 1 min)"),
              ),
            ),
          ),

          // PoW Difficulty
          h(
            "div",
            null,
            h("label", { className: "block text-xs font-medium text-neutral-300 mb-1" }, "PoW Anti-Spam Difficulty (bits)"),
            h("input", {
              type: "number",
              min: "0",
              max: "32",
              value: powBits,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPowBits(Number(e.target.value)),
              className:
                "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500",
            }),
            h("p", { className: "text-[11px] text-neutral-500 mt-0.5" }, "Default: 12 bits (~1-2 seconds in browser)."),
          ),
        ),
      ),

      // 2. Generated Deployment Instructions
      commands &&
        h(
          "div",
          { className: "rounded-lg border border-neutral-800 bg-neutral-900/60 p-5 space-y-5" },
          h(
            "div",
            null,
            h("h2", { className: "text-sm font-semibold text-white uppercase tracking-wider" }, "2. Deployment & Creation Instructions"),
            h(
              "p",
              { className: "text-xs text-neutral-400 mt-1" },
              "Execute the following NEAR CLI commands in order to open and fund the programme:",
            ),
          ),

          // Step 1: Open Programme
          h(
            "div",
            { className: "rounded-lg bg-neutral-950 p-4 border border-neutral-800 space-y-2" },
            h(
              "div",
              { className: "flex justify-between items-center" },
              h(
                "span",
                { className: "text-xs font-semibold text-sky-400" },
                "Step 1: Open Programme (",
                h("code", { className: "text-sky-300 font-mono" }, "create_programme / init_programme"),
                ")",
              ),
              h(
                "button",
                {
                  type: "button",
                  onClick: () => copyToClipboard(commands.createCommand, "step1"),
                  className: "text-xs text-sky-400 hover:text-sky-300 cursor-pointer",
                },
                copiedKey === "step1" ? "Copied!" : "Copy Command",
              ),
            ),
            h(
              "p",
              { className: "text-[11px] text-neutral-400" },
              `Attaches ${opsDepositNear} NEAR to fund initial ops balance for gas drips and storage deposits.`,
            ),
            h("pre", { className: "text-[11px] font-mono text-neutral-300 overflow-x-auto p-3 bg-black/60 rounded" }, commands.createCommand),
          ),

          // Step 2: Fund Reward Pool
          h(
            "div",
            { className: "rounded-lg bg-neutral-950 p-4 border border-neutral-800 space-y-2" },
            h(
              "div",
              { className: "flex justify-between items-center" },
              h(
                "span",
                { className: "text-xs font-semibold text-emerald-400" },
                "Step 2: Fund Reward Pool (",
                h("code", { className: "text-emerald-300 font-mono" }, "ft_transfer_call"),
                ")",
              ),
              h(
                "button",
                {
                  type: "button",
                  onClick: () => copyToClipboard(commands.fundCommand, "step2"),
                  className: "text-xs text-sky-400 hover:text-sky-300 cursor-pointer",
                },
                copiedKey === "step2" ? "Copied!" : "Copy Command",
              ),
            ),
            h(
              "p",
              { className: "text-[11px] text-neutral-400" },
              `Transfers ${initialFundUsdc} USDC into the programme via NEP-141. Replace `,
              h("code", { className: "text-neutral-300 font-mono" }, "<PROGRAMME_ID>"),
              " with the ID returned in Step 1.",
            ),
            h("pre", { className: "text-[11px] font-mono text-neutral-300 overflow-x-auto p-3 bg-black/60 rounded" }, commands.fundCommand),
          ),

          // Step 3: Top-up Ops Balance
          h(
            "div",
            { className: "rounded-lg bg-neutral-950 p-4 border border-neutral-800 space-y-2" },
            h(
              "div",
              { className: "flex justify-between items-center" },
              h("span", { className: "text-xs font-semibold text-amber-400" }, "Step 3: Top-Up Operations Balance"),
              h(
                "button",
                {
                  type: "button",
                  onClick: () => copyToClipboard(commands.topUpCommand, "step3"),
                  className: "text-xs text-sky-400 hover:text-sky-300 cursor-pointer",
                },
                copiedKey === "step3" ? "Copied!" : "Copy Instructions",
              ),
            ),
            h(
              "pre",
              { className: "text-[11px] font-mono text-neutral-300 overflow-x-auto p-3 bg-black/60 rounded whitespace-pre-wrap" },
              commands.topUpCommand,
            ),
          ),
        ),
    ),
  );
}
