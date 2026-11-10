"use client";

import React, { useEffect, useState } from "react";
import { publicConfig, type PublicConfig } from "../../../lib/config";

const h = React.createElement;

/** What the contract does to a funder's balance, point by point, in the order a tip moves through it. */
export const RESERVE_ON_TRIAGE_GUARANTEE = {
  title: "What happens to the money",
  points: [
    {
      heading: "Nothing is locked when a tip arrives",
      detail:
        "A submission reserves no reward funds, so a junk tip cannot freeze the pool. What it costs the tipster is CPU: the proof-of-work puzzle.",
    },
    {
      heading: "A reserve is taken at triage",
      detail:
        "When an appointed panel member marks a tip credible, exactly max_reward is reserved from the programme balance. No earlier.",
    },
    {
      heading: "Unreserved funds stay yours",
      detail:
        "balance − reserved can be moved at any time with withdraw_unreserved, including while another tip is under review.",
    },
    {
      heading: "A dismissal returns the reserve",
      detail:
        "Dismissed or rejected: the whole reserve comes back in that call. Accepted below max_reward: the unused part comes back then, and the reward part is freed when the tipster claims.",
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
    "div",
    { className: "mx-auto w-full max-w-4xl px-4 py-10 sm:px-6" },
    h(
      "div",
      { className: "card on-paper space-y-8 p-5 sm:p-8" },
      h(
        "div",
        { className: "space-y-3" },
        h("h1", { className: "display text-[clamp(1.75rem,5vw,2.25rem)] text-ask" }, "Fund a programme"),
        h(
          "p",
          { className: "text-sm leading-relaxed text-ink-muted" },
          "Set the scope and the bounty cap, lock the reward escrow, and hand adjudication to a panel of accounts you choose.",
        ),
        h("p", { className: "datum text-xs text-ink-muted" }, `Contract ${config?.contractId ?? "sealedtip.testnet"}`),
      ),

      // What the contract does to the balance
      h(
        "section",
        { "aria-labelledby": "reserve-title", className: "card-inset space-y-2 p-5" },
        h("h2", { id: "reserve-title", className: "text-sm font-semibold text-ink" }, RESERVE_ON_TRIAGE_GUARANTEE.title),
        h(
          "dl",
          { className: "divide-y divide-rule text-xs" },
          RESERVE_ON_TRIAGE_GUARANTEE.points.map((pt, idx) =>
            h(
              "div",
              { key: idx, className: "grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]" },
              h("dt", { className: "font-semibold text-ink" }, pt.heading),
              h("dd", { className: "leading-relaxed text-ink-muted" }, pt.detail),
            ),
          ),
        ),
      ),

      // 1. Programme Configuration Form
      h(
        "div",
        { className: "card-inset p-5 space-y-5" },
        h("h2", { className: "text-sm font-semibold text-ink" }, "1. Programme Configuration"),
        h(
          "div",
          { className: "grid grid-cols-1 md:grid-cols-2 gap-4" },
          // Title
          h(
            "div",
            { className: "md:col-span-2" },
            h(
              "label",
              { htmlFor: "programme-title-input", className: "block text-xs font-medium text-ink-muted mb-1" },
              "Programme title ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h("input", {
              id: "programme-title-input",
              type: "text",
              value: title,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value),
              placeholder: "e.g. Public Infrastructure Anti-Corruption Fund",
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted ",
            }),
          ),

          // Scope URI
          h(
            "div",
            { className: "md:col-span-2" },
            h(
              "label",
              { htmlFor: "programme-scope-uri-input", className: "block text-xs font-medium text-ink-muted mb-1" },
              "Scope URI (Rules, Boundaries & Policy Document) ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h("input", {
              id: "programme-scope-uri-input",
              type: "text",
              value: scopeUri,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setScopeUri(e.target.value),
              placeholder: "https://... or ipfs://…",
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink placeholder:text-ink-muted ",
            }),
          ),

          // Scope Narrative
          h(
            "div",
            { className: "md:col-span-2" },
            h("label", { htmlFor: "programme-scope-desc-input", className: "block text-xs font-medium text-ink-muted mb-1" }, "What a tip must be about"),
            h("textarea", {
              id: "programme-scope-desc-input",
              rows: 3,
              value: scopeDescription,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setScopeDescription(e.target.value),
              placeholder: "Describe reporting boundaries, required evidence, and terms…",
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted ",
            }),
          ),

          // Max Reward
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "programme-max-reward-input", className: "block text-xs font-medium text-ink-muted mb-1" },
              "Max Reward per Tip (USDC) ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h("input", {
              id: "programme-max-reward-input",
              type: "number",
              min: "1",
              step: "1",
              value: maxRewardUsdc,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setMaxRewardUsdc(e.target.value),
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink ",
            }),
            h("p", { className: "text-[11px] text-ink-muted mt-0.5" }, `Base units (6 decimals): ${usdcToUnits(maxRewardUsdc)}`),
          ),

          // Initial Funding Pool
          h(
            "div",
            null,
            h("label", { htmlFor: "programme-initial-fund-input", className: "block text-xs font-medium text-ink-muted mb-1" }, "Starting reward pool (USDC)"),
            h("input", {
              id: "programme-initial-fund-input",
              type: "number",
              min: "1",
              step: "1",
              value: initialFundUsdc,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInitialFundUsdc(e.target.value),
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink ",
            }),
            h("p", { className: "text-[11px] text-ink-muted mt-0.5" }, `Total fund deposited via NEP-141: ${usdcToUnits(initialFundUsdc)}`),
          ),

          // Ops Balance Deposit
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "programme-ops-deposit-input", className: "block text-xs font-medium text-ink-muted mb-1" },
              "Ops balance (NEAR) ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h("input", {
              id: "programme-ops-deposit-input",
              type: "number",
              min: "0.5",
              step: "0.5",
              value: opsDepositNear,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setOpsDepositNear(e.target.value),
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink ",
            }),
            h("p", { className: "text-[11px] text-ink-muted mt-0.5" }, "Covers gas drips (0.05 NEAR per payout) and NEP-141 destination storage deposits."),
          ),

          // Panel Sputnik DAO Account
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "programme-panel-dao-input", className: "block text-xs font-medium text-ink-muted mb-1" },
              "Panel DAO account ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h("input", {
              id: "programme-panel-dao-input",
              type: "text",
              value: panelDao,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPanelDao(e.target.value),
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink ",
            }),
            h("p", { className: "text-[11px] text-ink-muted mt-0.5" }, "Council responsible for appointing reviewers and voting on tip resolution."),
          ),

          // Token Account
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "programme-token-contract-input", className: "block text-xs font-medium text-ink-muted mb-1" },
              "Reward token contract (NEP-141) ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h("input", {
              id: "programme-token-contract-input",
              type: "text",
              value: tokenContract,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTokenContract(e.target.value),
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink ",
            }),
          ),

          // Funder Account
          h(
            "div",
            null,
            h(
              "label",
              { htmlFor: "programme-funder-account-input", className: "block text-xs font-medium text-ink-muted mb-1" },
              "Funder account ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h("input", {
              id: "programme-funder-account-input",
              type: "text",
              value: funderAccount,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFunderAccount(e.target.value),
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink ",
            }),
          ),

          // Time Scale
          h(
            "div",
            null,
            h(
              "span",
              { className: "block text-xs font-medium text-ink-muted mb-1" },
              "Interval clock ",
              h("span", { className: "text-bad" }, "*"),
            ),
            h(
              "div",
              { className: "flex flex-col sm:flex-row gap-2 mt-2", role: "radiogroup", "aria-label": "Interval clock" },
              h(
                "label",
                { className: "min-h-[44px] flex items-center gap-2 p-2 rounded-field text-xs cursor-pointer hover:bg-paper-2 transition-colors" },
                h("input", {
                  type: "radio",
                  name: "timeScale",
                  checked: timeScale === 1,
                  onChange: () => setTimeScale(1),
                  className: "h-4 w-4 accent-ask",
                }),
                h("span", null, "Real time (1×)"),
              ),
              h(
                "label",
                { className: "min-h-[44px] flex items-center gap-2 p-2 rounded-field text-xs cursor-pointer hover:bg-paper-2 transition-colors" },
                h("input", {
                  type: "radio",
                  name: "timeScale",
                  checked: timeScale === 1440,
                  onChange: () => setTimeScale(1440),
                  className: "h-4 w-4 accent-ask",
                }),
                h("span", null, "Demo: a day passes in a minute (1440×)"),
              ),
            ),
          ),

          // PoW Difficulty
          h(
            "div",
            null,
            h("label", { htmlFor: "programme-pow-bits-input", className: "block text-xs font-medium text-ink-muted mb-1" }, "Proof-of-work difficulty (bits)"),
            h("input", {
              id: "programme-pow-bits-input",
              type: "number",
              min: "0",
              max: "32",
              value: powBits,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPowBits(Number(e.target.value)),
              className:
              "w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm font-mono text-ink ",
            }),
            h("p", { className: "text-[11px] text-ink-muted mt-0.5" }, "Default 12 bits: about a second of CPU in the browser."),
          ),
        ),
      ),

      // 2. Generated Deployment Instructions
      commands &&
        h(
          "div",
          { className: "card-inset p-5 space-y-5" },
          h(
            "div",
            null,
            h("h2", { className: "text-sm font-semibold text-ink" }, "2. Deployment & Creation Instructions"),
            h(
              "p",
              { className: "text-xs text-ink-muted mt-1" },
              "Execute the following NEAR CLI commands in order to open and fund the programme:",
            ),
          ),

          // Step 1: Open Programme
          h(
            "div",
            { className: "card-inset p-4 space-y-2" },
            h(
              "div",
              { className: "flex justify-between items-center" },
              h(
                "span",
                { className: "text-xs font-semibold text-ask" },
                "Step 1: Open Programme (",
                h("code", { className: "text-ask font-mono" }, "create_programme / init_programme"),
                ")",
              ),
              h(
                "button",
                {
                  type: "button",
                  onClick: () => copyToClipboard(commands.createCommand, "step1"),
                  className: "min-h-[44px] px-3 inline-flex items-center text-xs text-ask hover:text-ask cursor-pointer rounded-field bg-paper-2 border border-rule hover:bg-paper-2 transition-colors",
                  "aria-label": "Copy Step 1 create programme command",
                },
                copiedKey === "step1" ? "Copied!" : "Copy command",
              ),
            ),
            h(
              "p",
              { className: "text-[11px] text-ink-muted" },
              `Attaches ${opsDepositNear} NEAR to fund initial ops balance for gas drips and storage deposits.`,
            ),
            h("pre", { className: "text-[11px] font-mono text-ink-muted overflow-x-auto p-3 bg-paper-3 rounded-inset" }, commands.createCommand),
          ),

          // Step 2: Fund Reward Pool
          h(
            "div",
            { className: "card-inset p-4 space-y-2" },
            h(
              "div",
              { className: "flex justify-between items-center" },
              h(
                "span",
                { className: "text-xs font-semibold text-ok" },
                "Step 2: Fund Reward Pool (",
                h("code", { className: "text-ok font-mono" }, "ft_transfer_call"),
                ")",
              ),
              h(
                "button",
                {
                  type: "button",
                  onClick: () => copyToClipboard(commands.fundCommand, "step2"),
                  className: "min-h-[44px] px-3 inline-flex items-center text-xs text-ask hover:text-ask cursor-pointer rounded-field bg-paper-2 border border-rule hover:bg-paper-2 transition-colors",
                  "aria-label": "Copy Step 2 fund reward pool command",
                },
                copiedKey === "step2" ? "Copied!" : "Copy command",
              ),
            ),
            h(
              "p",
              { className: "text-[11px] text-ink-muted" },
              `Transfers ${initialFundUsdc} USDC into the programme via NEP-141. Replace `,
              h("code", { className: "text-ink-muted font-mono" }, "<PROGRAMME_ID>"),
              " with the ID returned in Step 1.",
            ),
            h("pre", { className: "text-[11px] font-mono text-ink-muted overflow-x-auto p-3 bg-paper-3 rounded-inset" }, commands.fundCommand),
          ),

          // Step 3: Top-up Ops Balance
          h(
            "div",
            { className: "card-inset p-4 space-y-2" },
            h(
              "div",
              { className: "flex justify-between items-center" },
              h("span", { className: "text-xs font-semibold text-warn" }, "Step 3: Top-Up Operations Balance"),
              h(
                "button",
                {
                  type: "button",
                  onClick: () => copyToClipboard(commands.topUpCommand, "step3"),
                  className: "min-h-[44px] px-3 inline-flex items-center text-xs text-ask hover:text-ask cursor-pointer rounded-field bg-paper-2 border border-rule hover:bg-paper-2 transition-colors",
                  "aria-label": "Copy Step 3 top up operations instructions",
                },
                copiedKey === "step3" ? "Copied!" : "Copy the commands",
              ),
            ),
            h(
              "pre",
              { className: "text-[11px] font-mono text-ink-muted overflow-x-auto p-3 bg-paper-3 rounded-inset whitespace-pre-wrap" },
              commands.topUpCommand,
            ),
          ),
        ),
    ),
  );
}
