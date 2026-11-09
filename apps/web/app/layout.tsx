// Shell. NO analytics, web fonts, CDNs or external images (privacy invariant 3).
import "./globals.css";
import React, { type ReactNode } from "react";
import type { Viewport } from "next";

const h = React.createElement;

/**
 * Every route renders per request, on purpose.
 *
 * The CSP (S-10.1, privacy invariant 3) admits Next's own inline scripts with a per-request nonce, and a
 * nonce cannot exist on HTML written at build time — a prerendered page is a file, and its inline scripts
 * get stamped with whatever header the build process happened to see, which is none. Measured: the
 * prerendered landing page loaded with six blocked inline scripts and never hydrated, while the on-demand
 * routes under the same policy were clean. Static output is the thing that has to give, not the header.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sealed Tip — Anonymous Whistleblower Tip Line",
  description: "Anonymous, rewarded whistleblowing on NEAR. Client-side evidence cleaning, zero plaintext servers, and dead man's switch protection.",
  referrer: "no-referrer" as const,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return h(
    "html",
    { lang: "en", className: "dark" },
    h(
      "body",
      { className: "bg-neutral-950 text-neutral-100 antialiased min-h-screen" },
      h(
        "a",
        {
          href: "#main-content",
          className:
            "sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2.5 focus:bg-sky-600 focus:text-white focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-sky-400 font-medium text-sm",
        },
        "Skip to main content",
      ),
      children,
    ),
  );
}
