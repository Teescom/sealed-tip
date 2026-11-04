// Shell. NO analytics, web fonts, CDNs or external images (privacy invariant 3).
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Sealed Tip", description: "Anonymous, rewarded whistleblowing", referrer: "no-referrer" as const };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
