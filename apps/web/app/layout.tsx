// Shell. NO analytics, web fonts, CDNs or external images (privacy invariant 3).
import "./globals.css";
import React, { type ReactNode } from "react";
import type { Viewport } from "next";

const h = React.createElement;

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
