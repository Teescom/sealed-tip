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
      { className: "mx-auto w-full max-w-5xl px-4 py-10 sm:px-6", role: "status", "aria-live": "polite" },
      h(
        "div",
        { className: "panel flex items-center gap-4 p-5" },
        h("div", { className: "h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-ask-on-ground border-t-transparent", "aria-hidden": "true" }),
        h("p", { className: "font-mono text-sm text-on-ground-muted" }, `Loading programme #${idStr} from NEAR…`),
      ),
    );
  }

  if (error || !data) {
    return h(
      "div",
      { className: "mx-auto w-full max-w-3xl px-4 py-10 sm:px-6" },
      h(
        "div",
        { className: "card on-paper space-y-4 border-l-4 border-l-bad p-6", role: "alert", "aria-live": "assertive" },
        h("h1", { className: "display text-[clamp(1.75rem,5vw,2.25rem)] text-bad" }, "Programme error"),
        h("p", { className: "text-sm text-ink-muted" }, error ?? "Programme not found"),
        h(
          Link,
          {
            href: "/",
            className: "inline-flex min-h-[44px] items-center justify-center rounded-field border border-edge px-4 text-sm font-semibold text-ink hover:bg-paper-3",
          },
          "Back to the programmes list",
        ),
      ),
    );
  }

  const { programme, stats, keeper, tips } = data;

  return h(
    "div",
    { className: "mx-auto w-full max-w-5xl px-4 py-10 sm:px-6" },
    h(
      "div",
      { className: "card on-paper space-y-8 p-5 sm:p-8" },
      // Programme Header & Rules
      h(
        "section",
        { "aria-labelledby": "programme-header", className: "space-y-4" },
        h(
          "div",
          { className: "flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3 text-xs" },
          h(
            "div",
            { className: "flex items-center gap-2" },
            h(Link, { href: "/", className: "inline-flex min-h-[44px] items-center text-ink-muted hover:text-ink" }, "Programmes"),
            h("span", { className: "text-ink-muted", "aria-hidden": "true" }, "/"),
            h("span", { className: "datum font-semibold text-ask" }, `Programme #${programme.id}`),
          ),
          h(KeeperStatus, { lastSeenNs: keeper.keeper_last_seen }),
        ),
        h(
          "div",
          { className: "flex flex-col sm:flex-row sm:items-end justify-between gap-4" },
          h(
            "div",
            null,
            h(
              "div",
              { className: "flex flex-wrap items-center gap-3" },
              h("h1", { id: "programme-header", className: "display text-[clamp(1.75rem,5vw,2.5rem)] text-ink" }, programme.title || `Programme #${programme.id}`),
              h(
                "span",
                {
                  className: `text-xs font-semibold ${programme.open ? "text-ok" : "text-ink-muted"}`,
                },
                programme.open ? "Open" : "Closed",
              ),
            ),
            h(
              "dl",
              { className: "mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs" },
              h("div", { className: "flex gap-2" }, h("dt", { className: "text-ink-muted" }, "Funder"), h("dd", { className: "datum text-ink" }, programme.funder)),
              h("div", { className: "flex gap-2" }, h("dt", { className: "text-ink-muted" }, "Panel DAO"), h("dd", { className: "datum text-ink" }, programme.panel_dao)),
            ),
          ),
          h(
            Link,
            {
              href: `/submit/${programme.id}`,
              className: "btn-primary inline-flex min-h-[48px] items-center justify-center px-5 text-sm",
            },
            "Submit a tip to this programme",
          ),
        ),
        // Scope & rules: the four numbers a tipster actually checks before submitting.
        h(
          "dl",
          { className: "card-inset grid grid-cols-1 gap-x-8 gap-y-2 p-4 text-xs sm:grid-cols-2" },
          h(
            "div",
            { className: "flex items-baseline justify-between gap-4" },
            h("dt", { className: "shrink-0 text-ink-muted" }, "Scope"),
            h(
              "dd",
              { className: "datum truncate text-right" },
              programme.scope_uri.startsWith("http")
                ? h("a", { href: programme.scope_uri, target: "_blank", rel: "noopener noreferrer", className: "text-ask hover:underline" }, programme.scope_uri)
                : programme.scope_uri,
            ),
          ),
          h(
            "div",
            { className: "flex items-baseline justify-between gap-4" },
            h("dt", { className: "text-ink-muted" }, "Proof-of-work difficulty"),
            h("dd", { className: "datum text-right text-ink" }, `${programme.pow_bits} bits`),
          ),
          h(
            "div",
            { className: "flex items-baseline justify-between gap-4" },
            h("dt", { className: "text-ink-muted" }, "Max bounty per tip"),
            h("dd", { className: "datum text-right text-ink" }, formatTokenAmount(programme.max_reward)),
          ),
          h(
            "div",
            { className: "flex items-baseline justify-between gap-4" },
            h("dt", { className: "text-ink-muted" }, "Status"),
            h("dd", { className: "datum text-right text-ink" }, programme.open ? "Accepting tips" : "Closed"),
          ),
        ),
      ),
      // Escrow & Locked Funds
      h(
        "section",
        { "aria-labelledby": "funds-overview", className: "space-y-3" },
        h("h2", { id: "funds-overview", className: "text-sm font-semibold text-ink-muted" }, "Escrow"),
        h(
          "table",
          { className: "w-full text-left text-xs" },
          h(
            "thead",
            { className: "border-b border-rule text-[11px] uppercase tracking-wider text-ink-muted" },
            h(
              "tr",
              null,
              h("th", { scope: "col", className: "py-2 pr-4 font-medium" }, "Balance"),
              h("th", { scope: "col", className: "py-2 text-right font-medium" }, "Amount"),
              h("th", { scope: "col", className: "hidden py-2 pl-6 font-medium sm:table-cell" }, "What it can be spent on"),
            ),
          ),
          h(
            "tbody",
            { className: "divide-y divide-rule" },
            h(
              "tr",
              null,
              h("th", { scope: "row", className: "py-3 pr-4 font-medium text-ink" }, "Reward escrow"),
              h("td", { className: "datum py-3 text-right text-base font-semibold text-ok" }, formatTokenAmount(programme.balance)),
              h("td", { className: "hidden py-3 pl-6 text-ink-muted sm:table-cell" }, "Backs submissions the panel calls credible."),
            ),
            h(
              "tr",
              null,
              h("th", { scope: "row", className: "py-3 pr-4 font-medium text-ink" }, "Reserved"),
              h("td", { className: "datum py-3 text-right text-base font-semibold text-warn" }, formatTokenAmount(programme.reserved)),
              h("td", { className: "hidden py-3 pl-6 text-ink-muted sm:table-cell" }, "Withheld while a tip is in triage or awaiting a claim."),
            ),
            h(
              "tr",
              null,
              h("th", { scope: "row", className: "py-3 pr-4 font-medium text-ink" }, "Ops and gas drip"),
              h("td", { className: "datum py-3 text-right text-base font-semibold text-ask" }, formatNearAmount(programme.ops_balance)),
              h("td", { className: "hidden py-3 pl-6 text-ink-muted sm:table-cell" }, "Pays the relayer and the gas a claimer does not have to top up first."),
            ),
          ),
        ),
      ),
      // Statistics
      h(
        "section",
        { "aria-labelledby": "stats-heading", className: "space-y-3" },
        h("h2", { id: "stats-heading", className: "text-sm font-semibold text-ink-muted" }, "Submissions"),
        h(
          "dl",
          { className: "grid grid-cols-2 gap-x-8 sm:grid-cols-3" },
          ...[
            ["Submitted", stats.submitted, "text-ink"],
            ["Under review", stats.under_review, "text-ask"],
            ["Accepted", stats.accepted, "text-ok"],
            ["Rejected", stats.rejected, "text-bad"],
            ["Bounties paid", stats.paid, "text-ask"],
          ].map(([label, value, tone]) =>
            h(
              "div",
              { key: label, className: "border-b border-rule py-3" },
              h("dt", { className: "text-xs text-ink-muted" }, label),
              h("dd", { className: `datum text-2xl font-semibold ${tone}` }, value),
            ),
          ),
        ),
      ),
      // Public Tips List
      h(
        "section",
        { "aria-labelledby": "tips-list-heading", className: "space-y-3" },
        h(
          "div",
          { className: "flex flex-wrap items-baseline justify-between gap-2" },
          h("h2", { id: "tips-list-heading", className: "text-sm font-semibold text-ink-muted" }, "Tip activity"),
          h("p", { className: "text-xs text-ink-muted" }, "Tip ids only. Content ids and identities never appear in a public view."),
        ),
        tips.length === 0
          ? h(
              "p",
              { className: "border-y border-rule py-6 text-sm text-ink-muted" },
              "Nothing has been submitted to this programme yet. ",
              h(Link, { href: `/submit/${programme.id}`, className: "min-h-[44px] font-semibold text-ask hover:underline" }, "Be the first to submit a tip"),
            )
          : h(
              "div",
              { className: "overflow-x-auto" },
              h(
                "table",
                { className: "w-full text-left text-xs" },
                h(
                  "thead",
                  { className: "border-b border-rule text-[11px] uppercase tracking-wider text-ink-muted" },
                  h(
                    "tr",
                    null,
                    h("th", { scope: "col", className: "py-2 pr-4 font-medium" }, "Tip"),
                    h("th", { scope: "col", className: "py-2 pr-4 font-medium" }, "Status"),
                    h("th", { scope: "col", className: "py-2 pr-4 font-medium" }, "Submitted"),
                    h("th", { scope: "col", className: "py-2 font-medium" }, "Switch deadline"),
                  ),
                ),
                h(
                  "tbody",
                  { className: "divide-y divide-rule" },
                  tips.map((tip) =>
                    h(
                      "tr",
                      { key: tip.id },
                      h("th", { scope: "row", className: "datum py-3 pr-4 font-semibold text-ink" }, `#${tip.id}`),
                      h("td", { className: "py-3 pr-4 text-ink" }, getTipStatusLabel(tip.status)),
                      h("td", { className: "datum py-3 pr-4 text-ink-muted" }, formatAge(tip.submitted_at)),
                      h("td", { className: "datum py-3 text-ink-muted" }, formatDeadline(tip.switch_deadline, tip.switch_triggered)),
                    ),
                  ),
                ),
              ),
            ),
      ),
      // The one action this page can lead to.
      h(
        "div",
        { className: "flex flex-col gap-4 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between" },
        h(
          "div",
          { className: "space-y-1" },
          h("h3", { className: "display text-[clamp(1.5rem,4vw,2rem)] text-ink" }, "Have evidence to submit?"),
          h("p", { className: "text-sm text-ink-muted" }, "Files are cleaned and encrypted in your browser. No wallet, no account, no name."),
        ),
        h(
          Link,
          {
            href: `/submit/${programme.id}`,
            className: "btn-primary inline-flex min-h-[48px] shrink-0 items-center justify-center px-6 text-sm",
          },
          "Submit a tip",
        ),
      ),
    ),
  );
}
