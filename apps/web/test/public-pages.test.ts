import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it } from "vitest";

import { KeeperStatus } from "../components/KeeperStatus";
import {
  formatAge,
  formatDeadline,
  formatNearAmount,
  formatTokenAmount,
  getTipStatusLabel,
  list_programme_tips,
  loadProgrammeData,
} from "../app/p/[id]/page";
import type {
  KeeperInfo,
  Programme,
  ProgrammeStats,
  TipPublic,
  ViewClient,
} from "@sealedtip/core";

describe("KeeperStatus Component (S-10.3)", () => {
  const baseNow = 1_700_000_000_000; // Fixed epoch in ms

  it("renders 'Dead / Not yet seen' when lastSeenNs is '0'", () => {
    const html = renderToString(
      React.createElement(KeeperStatus, { lastSeenNs: "0", nowMs: baseNow }),
    );
    assert.match(html, /Dead \/ Not yet seen/);
    assert.match(html, /role="status"/);
    assert.match(html, /text-warn/);
  });

  it("renders the ok tone on 'Active (seen Xm ago)' when last seen < 30 minutes", () => {
    // 5 minutes ago = 300,000 ms ago
    const fiveMinutesAgoMs = baseNow - 5 * 60 * 1000;
    const fiveMinutesAgoNs = (BigInt(fiveMinutesAgoMs) * 1_000_000n).toString();

    const html = renderToString(
      React.createElement(KeeperStatus, {
        lastSeenNs: fiveMinutesAgoNs,
        nowMs: baseNow,
      }),
    );
    assert.match(html, /Active \(seen 5m ago\)/);
    assert.match(html, /text-ok/);
  });

  it("renders the warn tone on 'Delayed (seen Xm ago)' when last seen < 2 hours", () => {
    // 45 minutes ago = 2,700,000 ms ago (< 120 minutes)
    const fortyFiveMinutesAgoMs = baseNow - 45 * 60 * 1000;
    const fortyFiveMinutesAgoNs = (BigInt(fortyFiveMinutesAgoMs) * 1_000_000n).toString();

    const html = renderToString(
      React.createElement(KeeperStatus, {
        lastSeenNs: fortyFiveMinutesAgoNs,
        nowMs: baseNow,
      }),
    );
    assert.match(html, /Delayed \(seen 45m ago\)/);
    assert.match(html, /text-warn/);
  });

  it("renders the bad tone on 'Inactive (seen Xh ago)' when last seen >= 2 hours", () => {
    // 3 hours ago = 3 * 3600 * 1000 ms ago
    const threeHoursAgoMs = baseNow - 3 * 60 * 60 * 1000;
    const threeHoursAgoNs = (BigInt(threeHoursAgoMs) * 1_000_000n).toString();

    const html = renderToString(
      React.createElement(KeeperStatus, {
        lastSeenNs: threeHoursAgoNs,
        nowMs: baseNow,
      }),
    );
    assert.match(html, /Inactive \(seen 3h ago\)/);
    assert.match(html, /text-bad/);
  });

  it("gracefully falls back on invalid nanosecond string", () => {
    const html = renderToString(
      React.createElement(KeeperStatus, {
        lastSeenNs: "not-a-number",
        nowMs: baseNow,
      }),
    );
    assert.match(html, /Dead \/ Not yet seen/);
  });
});

describe("Public Pages Formatting & View Client Integration (S-10.2 & S-10.3)", () => {
  it("formats token and NEAR amounts correctly", () => {
    assert.equal(formatTokenAmount("5000000000", 6, "USDC"), "5000 USDC");
    assert.equal(formatTokenAmount("1500000", 6, "USDC"), "1.5 USDC");
    assert.equal(formatTokenAmount("0", 6, "USDC"), "0 USDC");

    // 0.05 NEAR = 50_000_000_000_000_000_000_000 yocto
    assert.equal(formatNearAmount("50000000000000000000000"), "0.05 NEAR");
    assert.equal(formatNearAmount("1000000000000000000000000"), "1 NEAR");
    assert.equal(formatNearAmount("0"), "0 NEAR");
  });

  it("formats relative age and deadline text", () => {
    const now = 1_700_000_000_000;
    const tenMinAgoNs = (BigInt(now - 10 * 60 * 1000) * 1_000_000n).toString();
    const twoHoursAgoNs = (BigInt(now - 2 * 3600 * 1000) * 1_000_000n).toString();
    const threeDaysAgoNs = (BigInt(now - 3 * 86400 * 1000) * 1_000_000n).toString();

    assert.equal(formatAge(tenMinAgoNs, now), "10m ago");
    assert.equal(formatAge(twoHoursAgoNs, now), "2h ago");
    assert.equal(formatAge(threeDaysAgoNs, now), "3d ago");

    assert.equal(formatDeadline(null, false), "None");
    assert.equal(formatDeadline("12345", true), "Triggered (Expired)");
  });

  it("formats TipStatus labels properly", () => {
    assert.equal(getTipStatusLabel("Submitted"), "Submitted");
    assert.equal(getTipStatusLabel("UnderReview"), "UnderReview");
    assert.equal(getTipStatusLabel("Paid"), "Paid");
    assert.equal(
      getTipStatusLabel({ Accepted: { reward: "250000000" } }),
      "Accepted (250 USDC)",
    );
  });

  it("lists programme tips through direct method or sequential probing", async () => {
    const fakeTips: TipPublic[] = [
      {
        id: 0,
        programme_id: 1,
        status: "Submitted",
        submitted_at: "1000000000",
        switch_deadline: null,
        switch_triggered: false,
      },
      {
        id: 1,
        programme_id: 2, // Different programme
        status: "UnderReview",
        submitted_at: "2000000000",
        switch_deadline: null,
        switch_triggered: false,
      },
      {
        id: 2,
        programme_id: 1,
        status: "Paid",
        submitted_at: "3000000000",
        switch_deadline: null,
        switch_triggered: false,
      },
    ];

    // Case 1: Probing getTipPublic
    const mockProbeClient = {
      async getTipPublic(id: number) {
        return fakeTips.find((t) => t.id === id) ?? null;
      },
    } as unknown as ViewClient;

    const probed = await list_programme_tips(mockProbeClient, 1, 0, 10);
    assert.equal(probed.length, 2);
    assert.ok(probed[0]);
    assert.equal(probed[0].id, 0);
    assert.ok(probed[1]);
    assert.equal(probed[1].id, 2);

    // Case 2: Custom list_programme_tips method
    const mockDirectClient = {
      async list_programme_tips(programmeId: bigint | number, _from: number, _limit: number) {
        return fakeTips.filter((t) => t.programme_id === Number(programmeId));
      },
    };

    const direct = await list_programme_tips(mockDirectClient, BigInt(1), 0, 10);
    assert.equal(direct.length, 2);
    assert.ok(direct[0]);
    assert.equal(direct[0].id, 0);
  });

  it("loads programme data and handles not-found correctly", async () => {
    const mockProgramme: Programme = {
      id: 0,
      funder: "funder.testnet",
      title: "Security Bounty Programme",
      scope_uri: "https://example.com/scope",
      scope_hash: new Array(32).fill(1),
      panel_dao: "panel.testnet",
      panel: [{ account: "panel1.testnet", x25519_pub: new Array(32).fill(2) }],
      token: "usdc.testnet",
      max_reward: "5000000000",
      balance: "25000000000",
      reserved: "5000000000",
      ops_balance: "50000000000000000000000",
      gas_drip: "5000000000000000000",
      pow_bits: 16,
      open: true,
      time_scale: 1,
      created_at: "1700000000000000000",
    };

    const mockStats: ProgrammeStats = {
      programme_id: 0,
      balance: "25000000000",
      reserved: "5000000000",
      submitted: 4,
      under_review: 1,
      accepted: 2,
      rejected: 1,
      paid: 0,
      keeper_last_seen: "1700000000000000000",
    };

    const mockKeeper: KeeperInfo = {
      keeper: "keeper.testnet",
      keeper_x25519_pub: new Array(32).fill(9),
      keeper_last_seen: "1700000000000000000",
    };

    const mockClient = {
      async getProgramme(id: number) {
        return id === 0 ? mockProgramme : null;
      },
      async getProgrammeStats(id: number) {
        if (id === 0) return mockStats;
        throw new Error("Programme not found");
      },
      async getKeeperInfo() {
        return mockKeeper;
      },
      async getTipPublic(_id: number) {
        return null;
      },
    } as unknown as ViewClient;

    const data = await loadProgrammeData(mockClient, 0);
    assert.ok(data !== null);
    assert.equal(data.programme.id, 0);
    assert.equal(data.programme.title, "Security Bounty Programme");
    assert.equal(data.stats.submitted, 4);
    assert.equal(data.keeper.keeper, "keeper.testnet");
    assert.equal(data.tips.length, 0);

    const missing = await loadProgrammeData(mockClient, 99);
    assert.equal(missing, null);
  });
});
