// Keeper heartbeat and status indicator (S-10.3)
import React, { type JSX } from "react";

export interface KeeperStatusProps {
  lastSeenNs: string;
  nowMs?: number;
}

export function KeeperStatus({ lastSeenNs, nowMs }: KeeperStatusProps): JSX.Element {
  let statusText = "Dead / Not yet seen";
  let statusClass = "text-amber-400 bg-amber-950/30 border-amber-800/60";
  let dotClass = "bg-amber-400";

  try {
    const ns = BigInt(lastSeenNs);
    if (ns <= 0n) {
      statusText = "Dead / Not yet seen";
      statusClass = "text-amber-400 bg-amber-950/30 border-amber-800/60";
      dotClass = "bg-amber-400";
    } else {
      const lastSeenMs = Number(ns / 1_000_000n);
      const currentNow = nowMs ?? Date.now();
      const elapsedMs = Math.max(0, currentNow - lastSeenMs);
      const minutes = Math.floor(elapsedMs / (60 * 1000));
      const hours = Math.floor(elapsedMs / (60 * 60 * 1000));

      if (elapsedMs < 30 * 60 * 1000) {
        statusText = `Active (seen ${minutes}m ago)`;
        statusClass = "text-emerald-400 bg-emerald-950/30 border-emerald-800/60";
        dotClass = "bg-emerald-400";
      } else if (elapsedMs < 2 * 60 * 60 * 1000) {
        statusText = `Delayed (seen ${minutes}m ago)`;
        statusClass = "text-amber-400 bg-amber-950/30 border-amber-800/60";
        dotClass = "bg-amber-400";
      } else {
        statusText = `Inactive (seen ${hours}h ago)`;
        statusClass = "text-red-400 bg-red-950/30 border-red-800/60";
        dotClass = "bg-red-400";
      }
    }
  } catch {
    statusText = "Dead / Not yet seen";
    statusClass = "text-red-400 bg-red-950/30 border-red-800/60";
    dotClass = "bg-red-400";
  }

  return React.createElement(
    "div",
    {
      role: "status",
      "aria-label": `Keeper status: ${statusText}`,
      className: `inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium border ${statusClass}`,
    },
    React.createElement("span", {
      className: `h-2 w-2 rounded-full ${dotClass} animate-pulse shrink-0`,
      "aria-hidden": "true",
    }),
    React.createElement("span", null, statusText),
  );
}
