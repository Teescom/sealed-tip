// Keeper heartbeat and status indicator (S-10.3)
import React, { type JSX } from "react";

export interface KeeperStatusProps {
  lastSeenNs: string;
  nowMs?: number;
}

export function KeeperStatus({ lastSeenNs, nowMs }: KeeperStatusProps): JSX.Element {
  let statusText = "Dead / Not yet seen";
  let tone = "text-warn";

  try {
    const ns = BigInt(lastSeenNs);
    if (ns <= 0n) {
      statusText = "Dead / Not yet seen";
      tone = "text-warn";
    } else {
      const lastSeenMs = Number(ns / 1_000_000n);
      const currentNow = nowMs ?? Date.now();
      const elapsedMs = Math.max(0, currentNow - lastSeenMs);
      const minutes = Math.floor(elapsedMs / (60 * 1000));
      const hours = Math.floor(elapsedMs / (60 * 60 * 1000));

      if (elapsedMs < 30 * 60 * 1000) {
        statusText = `Active (seen ${minutes}m ago)`;
        tone = "text-ok";
      } else if (elapsedMs < 2 * 60 * 60 * 1000) {
        statusText = `Delayed (seen ${minutes}m ago)`;
        tone = "text-warn";
      } else {
        statusText = `Inactive (seen ${hours}h ago)`;
        tone = "text-bad";
      }
    }
  } catch {
    statusText = "Dead / Not yet seen";
    tone = "text-bad";
  }

  // A heartbeat is a fact, not a light: label plus measured value, in the tone of the verdict.
  return React.createElement(
    "p",
    {
      role: "status",
      "aria-label": `Keeper status: ${statusText}`,
      className: "flex items-baseline gap-2 text-xs",
    },
    React.createElement("span", { className: "text-ink-muted" }, "Keeper"),
    React.createElement("span", { className: `datum font-semibold ${tone}` }, statusText),
  );
}
