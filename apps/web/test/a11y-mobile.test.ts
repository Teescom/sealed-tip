import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

import { viewport } from "../app/layout";
import { RecoveryWords } from "../components/RecoveryWords";
import { RecusalPicker } from "../components/RecusalPicker";
import { RedactionReview } from "../components/RedactionReview";
import { SwitchSettings } from "../components/SwitchSettings";
import { KeeperStatus } from "../components/KeeperStatus";

describe("Accessibility & Mobile Pass (S-10.9 / Issue #138)", () => {
  describe("Root Layout & Viewport (360px & iOS auto-zoom prevention)", () => {
    it("exports responsive viewport configuration", () => {
      expect(viewport).toBeDefined();
      expect(viewport.width).toBe("device-width");
      expect(viewport.initialScale).toBe(1);
      expect(viewport.maximumScale).toBe(5);
    });
  });

  describe("RecoveryWords Component", () => {
    const sampleWords = [
      "apple", "banana", "cherry", "date", "elder", "fig",
      "grape", "honeydew", "iris", "jujube", "kiwi", "lemon",
      "mango", "nectarine", "orange", "papaya", "quince", "raspberry",
      "strawberry", "tangerine", "ugli", "vanilla", "walnut", "xigua",
    ];

    it("renders with 2-to-4 column responsive grid and 44px copy button", () => {
      const html = renderToString(React.createElement(RecoveryWords, { words: sampleWords }));

      // Responsive mobile grid check
      expect(html).toContain("grid-cols-2");
      expect(html).toContain("sm:grid-cols-3");
      expect(html).toContain("md:grid-cols-4");

      // Minimum 44px tap target on copy action
      expect(html).toContain("min-h-[44px]");
      expect(html).toContain('aria-label="Copy all 24 recovery words to clipboard"');
    });
  });

  describe("RecusalPicker Component", () => {
    const panel = ["member1.near", "member2.near", "member3.near"];

    it("renders member selection with min 44px tap targets and aria-pressed", () => {
      const html = renderToString(
        React.createElement(RecusalPicker, {
          panel,
          value: ["member1.near"],
          onChange: () => {},
        }),
      );

      // Buttons have min-h-[44px]
      expect(html).toContain("min-h-[44px]");
      // ARIA pressed attributes
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('aria-pressed="false"');
      // Accessible instructions
      expect(html).toContain("Panel Recusal");
    });
  });

  describe("RedactionReview Component", () => {
    const suggestions = [
      {
        span: "Alice Corp",
        reason: "Identifies employer",
        replacement: "[ORGANISATION 1]",
      },
    ];

    it("renders review actions with min 44px tap targets and descriptive aria-labels", () => {
      const html = renderToString(
        React.createElement(RedactionReview, {
          suggestions,
          onAccept: () => {},
          onReject: () => {},
        }),
      );

      expect(html).toContain("min-h-[44px]");
      expect(html).toContain('aria-label="Keep original text');
      expect(html).toContain('aria-label="Accept replacement');
    });
  });

  describe("SwitchSettings Component", () => {
    it("renders toggle button and inputs with accessible labels and 44px touch targets", () => {
      const html = renderToString(
        React.createElement(SwitchSettings, {
          value: {
            interval: "30",
            grace: "7",
            includesRaw: false,
          },
          enabled: true,
          onChange: () => {},
          onToggle: () => {},
        }),
      );

      // 44px tap targets
      expect(html).toContain("min-h-[44px]");
      expect(html).toContain('aria-label="Toggle dead man&#x27;s switch. Currently armed"');
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('for="checkin-interval"');
      expect(html).toContain('for="grace-period"');
      expect(html).toContain('id="checkin-interval"');
      expect(html).toContain('id="grace-period"');
    });
  });

  describe("KeeperStatus Component", () => {
    it("renders with role=status and descriptive aria-label", () => {
      const recentNs = (BigInt(Date.now() - 5 * 60 * 1000) * 1_000_000n).toString();
      const html = renderToString(
        React.createElement(KeeperStatus, { lastSeenNs: recentNs, nowMs: Date.now() }),
      );

      expect(html).toContain('role="status"');
      expect(html).toContain('aria-label="Keeper status: Active');
    });
  });
});
