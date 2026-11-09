"use client";

import React, { use, useEffect, useState, type JSX } from "react";
import Link from "next/link";
import {
  createViewClient,
  type KeeperInfo,
  type Programme,
  type ProgrammeStats,
  type TipPublic,
  type TipStatus,
  type ViewClient,
} from "@sealedtip/core";

import { publicConfig, readPublicConfig } from "../../../lib/config";
import { KeeperStatus } from "../../../components/KeeperStatus";

const h = React.createElement;

// Alias as webConfig to satisfy contract/test requirements
export const webConfig = publicConfig;

export interface ProgrammeViewData {
  programme: Programme;
  stats: ProgrammeStats;
  keeper: KeeperInfo;
  tips: TipPublic[];
}

export function formatTokenAmount(amountU128: string, decimals = 6, symbol = "USDC"): string {
  try {
    const raw = BigInt(amountU128);
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    if (frac === 0n) return `${whole.toString()} ${symbol}`;
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toString()}.${fracStr} ${symbol}`;
  } catch {
    return `${amountU128} ${symbol}`;
  }
}

export function formatNearAmount(yoctoNear: string): string {
  try {
    const raw = BigInt(yoctoNear);
    const divisor = 10n ** 24n;
    const whole = raw / divisor;
    const frac = raw % divisor;
    if (frac === 0n) return `${whole.toString()} NEAR`;
    const fracStr = frac.toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole.toString()}.${fracStr} NEAR` : `${whole.toString()} NEAR`;
  } catch {
    return `${yoctoNear} yoctoNEAR`;
  }
}

export function formatAge(timestampNs: string | number, nowMs?: number): string {
  try {
    const ms = Number(BigInt(timestampNs) / 1_000_000n);
    const current = nowMs ?? Date.now();
    const elapsedMs = Math.max(0, current - ms);
    const mins = Math.floor(elapsedMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "unknown";
  }
}

export function formatDeadline(deadlineNs: string | null, triggered: boolean): string {
  if (triggered) return "Triggered (Expired)";
  if (!deadlineNs) return "None";
  try {
    const ms = Number(BigInt(deadlineNs) / 1_000_000n);
    const diffMs = ms - Date.now();
    if (diffMs <= 0) return "Expired (pending release)";
    const hours = Math.floor(diffMs / 3_600_000);
    if (hours < 24) return `in ${hours}h`;
    const days = Math.floor(hours / 24);
    return `in ${days}d`;
  } catch {
    return "Active";
  }
}

export function getTipStatusLabel(status: TipStatus): string {
  if (typeof status === "string") {
    return status;
  }
  if (status && typeof status === "object" && "Accepted" in status) {
    return `Accepted (${formatTokenAmount(status.Accepted.reward)})`;
  }
  return "Unknown";
}

export async function list_programme_tips(
  client:
    | ViewClient
    | {
        list_programme_tips?: (
          id: bigint | number,
          from: number,
          limit: number,
        ) => Promise<TipPublic[]>;
        listProgrammeTips?: (
          id: bigint | number,
          from: number,
          limit: number,
        ) => Promise<TipPublic[]>;
        getTipPublic?: (id: number) => Promise<TipPublic | null>;
      },
  programmeId: bigint | number,
  fromIndex = 0,
  limit = 20,
): Promise<TipPublic[]> {
  if (typeof (client as Record<string, unknown>).list_programme_tips === "function") {
    return (
      client as {
        list_programme_tips: (
          id: bigint | number,
          from: number,
          limit: number,
        ) => Promise<TipPublic[]>;
      }
    ).list_programme_tips(programmeId, fromIndex, limit);
  }
  if (typeof (client as Record<string, unknown>).listProgrammeTips === "function") {
    return (
      client as {
        listProgrammeTips: (
          id: bigint | number,
          from: number,
          limit: number,
        ) => Promise<TipPublic[]>;
      }
    ).listProgrammeTips(programmeId, fromIndex, limit);
  }

  const pId = Number(programmeId);
  const results: TipPublic[] = [];
  let currentId = fromIndex;
  let consecutiveMisses = 0;

  while (results.length < limit && consecutiveMisses < 5 && currentId < fromIndex + 100) {
    try {
      const tip = await (client as ViewClient).getTipPublic(currentId);
      if (tip) {
        consecutiveMisses = 0;
        if (tip.programme_id === pId) {
          results.push(tip);
        }
      } else {
        consecutiveMisses++;
      }
    } catch {
      break;
    }
    currentId++;
  }
  return results;
}

export async function loadProgrammeData(
  views:
    | ViewClient
    | {
        getProgramme?: (id: number) => Promise<Programme | null>;
        get_programme?: (id: bigint | number) => Promise<Programme | null>;
        getProgrammeStats?: (id: number) => Promise<ProgrammeStats>;
        get_programme_stats?: (id: bigint | number) => Promise<ProgrammeStats>;
        getKeeperInfo?: () => Promise<KeeperInfo>;
        get_keeper_info?: () => Promise<KeeperInfo>;
        list_programme_tips?: (
          id: bigint | number,
          from: number,
          limit: number,
        ) => Promise<TipPublic[]>;
        getTipPublic?: (id: number) => Promise<TipPublic | null>;
      },
  id: bigint | number,
): Promise<ProgrammeViewData | null> {
  const numId = Number(id);
  const bigId = typeof id === "bigint" ? id : BigInt(id);

  // 1. get_programme(BigInt(id))
  let programme: Programme | null = null;
  if (typeof views.getProgramme === "function") {
    programme = await views.getProgramme(numId);
  } else if (
    typeof (views as { get_programme?: (id: bigint) => Promise<Programme | null> })
      .get_programme === "function"
  ) {
    programme = await (
      views as { get_programme: (id: bigint) => Promise<Programme | null> }
    ).get_programme(bigId);
  }

  if (!programme) return null;

  // 2. get_programme_stats(BigInt(id))
  let stats: ProgrammeStats;
  if (typeof views.getProgrammeStats === "function") {
    stats = await views.getProgrammeStats(numId);
  } else if (
    typeof (views as { get_programme_stats?: (id: bigint) => Promise<ProgrammeStats> })
      .get_programme_stats === "function"
  ) {
    stats = await (
      views as { get_programme_stats: (id: bigint) => Promise<ProgrammeStats> }
    ).get_programme_stats(bigId);
  } else {
    throw new Error("Missing get_programme_stats method on client");
  }

  // 3. get_keeper_info()
  let keeper: KeeperInfo;
  if (typeof views.getKeeperInfo === "function") {
    keeper = await views.getKeeperInfo();
  } else if (
    typeof (views as { get_keeper_info?: () => Promise<KeeperInfo> }).get_keeper_info ===
    "function"
  ) {
    keeper = await (
      views as { get_keeper_info: () => Promise<KeeperInfo> }
    ).get_keeper_info();
  } else {
    keeper = {
      keeper: "keeper.testnet",
      keeper_x25519_pub: new Array(32).fill(0),
      keeper_last_seen: stats.keeper_last_seen,
    };
  }

  // 4. list_programme_tips(BigInt(id), 0, 20)
  const tips = await list_programme_tips(views as ViewClient, bigId, 0, 20);

  return { programme, stats, keeper, tips };
}

export default function ProgrammePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): JSX.Element {
  const unwrappedParams = use(params);
  const idStr = unwrappedParams.id;
  const programmeIdNum = Number.parseInt(idStr, 10);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProgrammeViewData | null>(null);

  useEffect(() => {
    const env = {
      NEXT_PUBLIC_NEAR_NETWORK: process.env.NEXT_PUBLIC_NEAR_NETWORK,
      NEXT_PUBLIC_NEAR_RPC_URL: process.env.NEXT_PUBLIC_NEAR_RPC_URL,
      NEXT_PUBLIC_SEALEDTIP_CONTRACT: process.env.NEXT_PUBLIC_SEALEDTIP_CONTRACT,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
      NEXT_PUBLIC_TOKEN_CONTRACT: process.env.NEXT_PUBLIC_TOKEN_CONTRACT,
    };
    const res = readPublicConfig(env);
    if (!res.ok) {
      setError(`Configuration error: ${res.problems.join("; ")}`);
      setLoading(false);
      return;
    }

    if (Number.isNaN(programmeIdNum) || programmeIdNum < 0) {
      setError(`Invalid programme ID "${idStr}". Programme IDs must be non-negative integers.`);
      setLoading(false);
      return;
    }

    const views = createViewClient(res.config.rpcUrl, res.config.contractId);
    loadProgrammeData(views, BigInt(programmeIdNum))
      .then((viewData) => {
        if (!viewData) {
          setError(`Programme #${idStr} was not found on-chain.`);
        } else {
          setData(viewData);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [idStr, programmeIdNum]);

  if (loading) {
    return h(
      "div",
      { className: "min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4" },
      h(
        "div",
        { className: "text-center space-y-3" },
        h("div", { className: "inline-block h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" }),
        h("p", { className: "text-sm font-mono text-neutral-400" }, `Loading programme #${idStr} from NEAR...`),
      ),
    );
  }

  if (error || !data) {
    return h(
      "div",
      { className: "min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4" },
      h(
        "div",
        { className: "max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-xl p-6 text-center space-y-4" },
        h("div", { className: "h-10 w-10 mx-auto rounded-full bg-red-950/40 border border-red-800/60 flex items-center justify-center text-red-400 font-bold" }, "!"),
        h("h1", { className: "text-lg font-bold text-white" }, "Programme Error"),
        h("p", { className: "text-sm text-neutral-400" }, error ?? "Programme not found"),
        h(
          "div",
          { className: "pt-2" },
          h(Link, { href: "/", className: "inline-block bg-neutral-800 hover:bg-neutral-700 text-white text-xs px-4 py-2 rounded-lg font-medium transition-colors" }, "← Back to Overview"),
        ),
      ),
    );
  }

  const { programme, stats, keeper, tips } = data;

  return h(
    "div",
    { className: "min-h-screen bg-neutral-950 text-neutral-100 pb-16" },
    // Header
    h(
      "header",
      { className: "border-b border-neutral-800 bg-neutral-900/60 sticky top-0 z-40 backdrop-blur" },
      h(
        "div",
        { className: "max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between" },
        h(
          "div",
          { className: "flex items-center gap-3" },
          h(Link, { href: "/", className: "text-neutral-400 hover:text-white text-xs transition-colors" }, "← Sealed Tip"),
          h("span", { className: "text-neutral-600" }, "/"),
          h("span", { className: "text-xs font-mono font-bold text-sky-400" }, `Programme #${programme.id}`),
        ),
        h(
          "div",
          { className: "flex items-center gap-3" },
          h(KeeperStatus, { lastSeenNs: keeper.keeper_last_seen }),
          h(
            Link,
            {
              href: `/submit/${programme.id}`,
              className: "bg-sky-600 hover:bg-sky-500 text-white text-xs px-3.5 py-1.5 rounded-lg font-semibold transition-colors shadow-sm",
            },
            "Submit Anonymous Tip",
          ),
        ),
      ),
    ),
    // Main Content
    h(
      "main",
      { className: "max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8" },
      // Programme Header & Rules
      h(
        "section",
        { "aria-labelledby": "programme-header", className: "space-y-4" },
        h(
          "div",
          { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-4" },
          h(
            "div",
            null,
            h(
              "div",
              { className: "flex items-center gap-2" },
              h("h1", { id: "programme-header", className: "text-2xl sm:text-3xl font-extrabold text-white tracking-tight" }, programme.title || `Programme #${programme.id}`),
              h(
                "span",
                {
                  className: `text-xs px-2 py-0.5 rounded-full font-mono font-medium ${
                    programme.open
                      ? "text-emerald-400 bg-emerald-950/40 border border-emerald-800/60"
                      : "text-neutral-400 bg-neutral-900 border border-neutral-700"
                  }`,
                },
                programme.open ? "Active" : "Closed",
              ),
            ),
            h(
              "p",
              { className: "text-xs text-neutral-400 font-mono mt-1" },
              "Funder: ",
              h("span", { className: "text-neutral-200" }, programme.funder),
              " • Panel DAO: ",
              h("span", { className: "text-neutral-200" }, programme.panel_dao),
            ),
          ),
          h(
            Link,
            {
              href: `/submit/${programme.id}`,
              className: "inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-lg shadow-sky-950/50",
            },
            h("span", null, "Submit Anonymous Tip"),
            h("span", { "aria-hidden": "true" }, "→"),
          ),
        ),
        // Scope & Rules Box
        h(
          "div",
          { className: "p-4 rounded-xl border border-neutral-800 bg-neutral-900/40 text-xs space-y-2" },
          h("span", { className: "text-neutral-400 font-semibold block uppercase tracking-wider text-[10px]" }, "Inspection Scope & Rules"),
          h(
            "div",
            { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-2" },
            h(
              "div",
              { className: "space-y-1 font-mono" },
              h(
                "div",
                { className: "text-neutral-300" },
                "Scope URI: ",
                programme.scope_uri.startsWith("http")
                  ? h("a", { href: programme.scope_uri, target: "_blank", rel: "noopener noreferrer", className: "text-sky-400 hover:underline" }, programme.scope_uri)
                  : h("span", { className: "text-neutral-200" }, programme.scope_uri),
              ),
              h("div", { className: "text-neutral-400 text-[11px]" }, `Proof of Work Target: ${programme.pow_bits} bits difficulty`),
            ),
            h(
              "div",
              { className: "text-right sm:text-right font-mono" },
              h("span", { className: "text-neutral-400 block text-[11px]" }, "Max Bounty Per Tip"),
              h("span", { className: "text-emerald-400 font-bold text-sm" }, formatTokenAmount(programme.max_reward)),
            ),
          ),
        ),
      ),
      // Escrow & Locked Funds
      h(
        "section",
        { "aria-labelledby": "funds-overview", className: "space-y-3" },
        h("h2", { id: "funds-overview", className: "text-sm font-semibold uppercase tracking-wider text-neutral-400" }, "Escrow & Locked Funds"),
        h(
          "div",
          { className: "grid grid-cols-1 sm:grid-cols-3 gap-4" },
          h(
            "div",
            { className: "p-4 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-1" },
            h("span", { className: "text-xs text-neutral-400 font-mono block" }, "Locked Reward Balance"),
            h("span", { className: "text-xl font-bold font-mono text-emerald-400 block" }, formatTokenAmount(programme.balance)),
            h("span", { className: "text-[11px] text-neutral-500" }, "Available to back credible submissions"),
          ),
          h(
            "div",
            { className: "p-4 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-1" },
            h("span", { className: "text-xs text-neutral-400 font-mono block" }, "Reserved (Under Triage)"),
            h("span", { className: "text-xl font-bold font-mono text-amber-400 block" }, formatTokenAmount(programme.reserved)),
            h("span", { className: "text-[11px] text-neutral-500" }, "Reserved for accepted or pending tips"),
          ),
          h(
            "div",
            { className: "p-4 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-1" },
            h("span", { className: "text-xs text-neutral-400 font-mono block" }, "Ops & Gas Drip Balance"),
            h("span", { className: "text-xl font-bold font-mono text-sky-400 block" }, formatNearAmount(programme.ops_balance)),
            h("span", { className: "text-[11px] text-neutral-500" }, "Subsidises gas drip for anonymous claimers"),
          ),
        ),
      ),
      // Statistics
      h(
        "section",
        { "aria-labelledby": "stats-heading", className: "space-y-3" },
        h("h2", { id: "stats-heading", className: "text-sm font-semibold uppercase tracking-wider text-neutral-400" }, "Submission Outcomes"),
        h(
          "div",
          { className: "grid grid-cols-2 sm:grid-cols-5 gap-3 text-center" },
          h(
            "div",
            { className: "p-3 rounded-lg border border-neutral-800 bg-neutral-900/30" },
            h("span", { className: "text-[11px] text-neutral-400 block" }, "Total Submitted"),
            h("span", { className: "text-lg font-bold font-mono text-white mt-0.5 block" }, stats.submitted),
          ),
          h(
            "div",
            { className: "p-3 rounded-lg border border-neutral-800 bg-neutral-900/30" },
            h("span", { className: "text-[11px] text-neutral-400 block" }, "Under Review"),
            h("span", { className: "text-lg font-bold font-mono text-sky-400 mt-0.5 block" }, stats.under_review),
          ),
          h(
            "div",
            { className: "p-3 rounded-lg border border-neutral-800 bg-neutral-900/30" },
            h("span", { className: "text-[11px] text-neutral-400 block" }, "Accepted"),
            h("span", { className: "text-lg font-bold font-mono text-emerald-400 mt-0.5 block" }, stats.accepted),
          ),
          h(
            "div",
            { className: "p-3 rounded-lg border border-neutral-800 bg-neutral-900/30" },
            h("span", { className: "text-[11px] text-neutral-400 block" }, "Rejected / Dismissed"),
            h("span", { className: "text-lg font-bold font-mono text-red-400 mt-0.5 block" }, stats.rejected),
          ),
          h(
            "div",
            { className: "p-3 rounded-lg border border-neutral-800 bg-neutral-900/30 col-span-2 sm:col-span-1" },
            h("span", { className: "text-[11px] text-neutral-400 block" }, "Bounties Paid"),
            h("span", { className: "text-lg font-bold font-mono text-teal-400 mt-0.5 block" }, stats.paid),
          ),
        ),
      ),
      // Public Tips List
      h(
        "section",
        { "aria-labelledby": "tips-list-heading", className: "space-y-3" },
        h(
          "div",
          { className: "flex items-center justify-between" },
          h("h2", { id: "tips-list-heading", className: "text-sm font-semibold uppercase tracking-wider text-neutral-400" }, "Public Tip Activity"),
          h("span", { className: "text-[11px] text-neutral-500 font-mono" }, "Privacy Invariant: CIDs and identities are strictly omitted from public views."),
        ),
        tips.length === 0
          ? h(
              "div",
              { className: "p-8 text-center rounded-xl border border-neutral-800 bg-neutral-900/20 space-y-2" },
              h("p", { className: "text-sm text-neutral-400" }, "No public tips submitted yet to this programme."),
              h(Link, { href: `/submit/${programme.id}`, className: "text-xs text-sky-400 hover:underline font-semibold" }, "Be the first to submit a confidential tip →"),
            )
          : h(
              "div",
              { className: "overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900/40" },
              h(
                "table",
                { className: "w-full text-left text-xs" },
                h(
                  "thead",
                  { className: "bg-neutral-950/60 border-b border-neutral-800 text-[11px] uppercase tracking-wider text-neutral-400 font-mono" },
                  h(
                    "tr",
                    null,
                    h("th", { scope: "col", className: "px-4 py-3 font-medium" }, "Tip ID"),
                    h("th", { scope: "col", className: "px-4 py-3 font-medium" }, "Status"),
                    h("th", { scope: "col", className: "px-4 py-3 font-medium" }, "Submitted"),
                    h("th", { scope: "col", className: "px-4 py-3 font-medium" }, "Switch Deadline"),
                  ),
                ),
                h(
                  "tbody",
                  { className: "divide-y divide-neutral-800/60 font-mono" },
                  tips.map((tip) =>
                    h(
                      "tr",
                      { key: tip.id, className: "hover:bg-neutral-800/30 transition-colors" },
                      h("td", { className: "px-4 py-3 font-semibold text-white" }, `#${tip.id}`),
                      h(
                        "td",
                        { className: "px-4 py-3" },
                        h("span", { className: "inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-800 text-neutral-200" }, getTipStatusLabel(tip.status)),
                      ),
                      h("td", { className: "px-4 py-3 text-neutral-400" }, formatAge(tip.submitted_at)),
                      h("td", { className: "px-4 py-3 text-neutral-400" }, formatDeadline(tip.switch_deadline, tip.switch_triggered)),
                    ),
                  ),
                ),
              ),
            ),
      ),
      // Bottom CTA
      h(
        "section",
        { className: "p-6 rounded-2xl border border-sky-800/60 bg-gradient-to-r from-sky-950/40 to-neutral-900/60 flex flex-col sm:flex-row items-center justify-between gap-4" },
        h(
          "div",
          { className: "space-y-1 text-center sm:text-left" },
          h("h3", { className: "text-base font-bold text-white" }, "Have confidential evidence to submit?"),
          h("p", { className: "text-xs text-neutral-300" }, "Your files will be destructive-rasterised in your browser. No wallet or identity needed."),
        ),
        h(
          Link,
          {
            href: `/submit/${programme.id}`,
            className: "bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm px-6 py-2.5 rounded-xl transition-colors shrink-0 shadow-md",
          },
          "Submit Anonymous Tip",
        ),
      ),
    ),
  );
}
