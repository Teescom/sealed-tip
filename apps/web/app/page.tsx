"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 selection:bg-sky-500/30 selection:text-sky-200">
      {/* Top Header / Navigation */}
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center font-bold text-sky-400 font-mono">
              ST
            </div>
            <div>
              <span className="font-bold tracking-tight text-white block leading-tight">
                Sealed Tip
              </span>
              <span className="text-[10px] text-neutral-400 uppercase tracking-widest font-mono block">
                Whistleblower Tip Line
              </span>
            </div>
          </div>

          <nav aria-label="Main Navigation" className="flex items-center gap-3 sm:gap-4 text-xs font-medium">
            <Link
              href="/p/0"
              className="text-neutral-300 hover:text-white transition-colors"
            >
              Programmes
            </Link>
            <Link
              href="/status"
              className="text-neutral-300 hover:text-white transition-colors"
            >
              Check Status
            </Link>
            <Link
              href="/claim"
              className="text-neutral-300 hover:text-white transition-colors"
            >
              Claim Reward
            </Link>
            <Link
              href="/panel"
              className="text-neutral-300 hover:text-white transition-colors hidden md:inline-block"
            >
              Panel DAO
            </Link>
            <Link
              href="/submit/0"
              className="bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded-lg transition-colors font-semibold"
            >
              Submit Tip
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-12">
        {/* Hero & Problem Statement */}
        <section aria-labelledby="hero-title" className="space-y-6 max-w-4xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono bg-sky-950/40 border border-sky-800/60 text-sky-400">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
            <span>NEAR Privacy & Private AI • Zero-Knowledge Architecture</span>
          </div>

          <h1
            id="hero-title"
            className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight"
          >
            Anonymous, verified whistleblowing with guaranteed bounties.
          </h1>

          <div className="p-6 rounded-xl border border-red-900/40 bg-red-950/20 space-y-3">
            <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
              <svg
                className="w-5 h-5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>The Problem: Whistleblowing is dangerous</span>
            </div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              Whistleblowing is dangerous. Documents and leak files carry invisible forensics:
              yellow printer tracking dots (Machine Identification Codes), high-precision EXIF GPS coordinates,
              hidden PDF revision histories and undo logs, font-render metadata, and unique stylometric fingerprints.
              Traditional tip lines claim confidentiality while logging your IP address, storing plaintext on central servers,
              and relying on promises rather than cryptography.
            </p>
          </div>
        </section>

        {/* Tor Guidance / Operational Security Callout */}
        <section
          aria-labelledby="tor-guidance-heading"
          className="p-6 sm:p-8 rounded-2xl border border-amber-800/60 bg-gradient-to-br from-amber-950/30 to-neutral-900/40 space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400">
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <div>
              <h2 id="tor-guidance-heading" className="text-lg font-bold text-amber-300">
                Operational Security & Tor Guidance
              </h2>
              <p className="text-xs text-amber-400/80">
                Network-level privacy requires strict operational discipline before you begin.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-neutral-300 pt-2">
            <div className="p-4 rounded-lg bg-neutral-950/60 border border-neutral-800 space-y-1.5">
              <span className="font-semibold text-white block">1. Use Tor Browser or Tails OS</span>
              <p className="text-neutral-400">
                Always access Sealed Tip through the official Tor Browser or booted inside Tails OS.
                Tor onion routing masks your real IP address from internet service providers, relay nodes, and adversaries.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-neutral-950/60 border border-neutral-800 space-y-1.5">
              <span className="font-semibold text-white block">2. Avoid Personal Wi-Fi & Work Nets</span>
              <p className="text-neutral-400">
                Never submit tips or check status from home broadband, employer VPNs, or personal mobile data.
                Use a public Wi-Fi access point without security cameras or captive login portals.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-neutral-950/60 border border-neutral-800 space-y-1.5">
              <span className="font-semibold text-white block">3. Use a Dedicated Clean Device</span>
              <p className="text-neutral-400">
                Disable persistent tracking, close background syncing applications (cloud backups, messaging apps),
                and avoid logging into any personal accounts on the hardware you use for whistleblowing.
              </p>
            </div>
          </div>
        </section>

        {/* How Sealed Tip Protects You */}
        <section aria-labelledby="protection-heading" className="space-y-6">
          <div className="space-y-2">
            <h2 id="protection-heading" className="text-2xl font-bold text-white tracking-tight">
              How Sealed Tip Protects You
            </h2>
            <p className="text-sm text-neutral-400">
              Privacy is the product. Every layer of Sealed Tip is designed so that even our own servers cannot identify you.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <article className="p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-3">
              <div className="h-9 w-9 rounded-lg bg-sky-950/60 border border-sky-800/60 flex items-center justify-center text-sky-400 font-bold">
                01
              </div>
              <h3 className="text-base font-semibold text-white">
                Destructive Browser-Side Cleaning
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Evidence files are sanitised entirely inside your web browser prior to encryption. PDFs are rasterised to pure pixels to strip revision histories, images are re-encoded to discard EXIF GPS metadata, and photocopier composite scan mode destroys printer tracking dots.
              </p>
            </article>

            {/* Feature 2 */}
            <article className="p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-emerald-400 font-bold">
                02
              </div>
              <h3 className="text-base font-semibold text-white">
                Strict Privacy Invariants
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Zero plaintext ever touches any server. Ciphertext is stored exclusively. Servers run strict <code>noLogs</code> middleware with zero IP logging, zero cookies, no web trackers, and zero third-party CDNs or external web fonts.
              </p>
            </article>

            {/* Feature 3 */}
            <article className="p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-3">
              <div className="h-9 w-9 rounded-lg bg-purple-950/60 border border-purple-800/60 flex items-center justify-center text-purple-400 font-bold">
                03
              </div>
              <h3 className="text-base font-semibold text-white">
                Verifiable TEE AI Redaction
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Tip text can optionally be redacted using NEAR AI Cloud Confidential Computing enclaves. Hardware Intel SGX/TDX attestation reports verify the exact model and enclave state without decrypting your submission on the host.
              </p>
            </article>

            {/* Feature 4 */}
            <article className="p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-3">
              <div className="h-9 w-9 rounded-lg bg-amber-950/60 border border-amber-800/60 flex items-center justify-center text-amber-400 font-bold">
                04
              </div>
              <h3 className="text-base font-semibold text-white">
                Dead Man&apos;s Switch Protection
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Arm an automated dead man&apos;s switch. If you are detained, silenced, or fail to check in before your deadline, an autonomous keeper daemon releases decryption keys to the DAO panel to ensure the truth cannot be suppressed.
              </p>
            </article>

            {/* Feature 5 */}
            <article className="p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-3">
              <div className="h-9 w-9 rounded-lg bg-teal-950/60 border border-teal-800/60 flex items-center justify-center text-teal-400 font-bold">
                05
              </div>
              <h3 className="text-base font-semibold text-white">
                Accountless 24-Word Identity
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                You never connect a wallet or register an account. Your tipster identity is derived entirely in memory from a 24-word secret recovery phrase. Actions are signed locally and submitted through an anonymous relayer.
              </p>
            </article>

            {/* Feature 6 */}
            <article className="p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-3">
              <div className="h-9 w-9 rounded-lg bg-rose-950/60 border border-rose-800/60 flex items-center justify-center text-rose-400 font-bold">
                06
              </div>
              <h3 className="text-base font-semibold text-white">
                On-Chain Escrowed Rewards
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Bounty rewards are locked in the NEAR smart contract beforehand. Funder balances are cryptographically reserved upon positive triage, and payouts can be directed to fresh, unlinked addresses on NEAR or multi-chain.
              </p>
            </article>
          </div>
        </section>

        {/* Quick Navigation / Action Hub */}
        <section aria-labelledby="quick-nav-heading" className="space-y-6">
          <div className="space-y-1">
            <h2 id="quick-nav-heading" className="text-2xl font-bold text-white tracking-tight">
              Programmes & Navigation
            </h2>
            <p className="text-sm text-neutral-400">
              Access active whistleblower programmes, track submissions, or participate in governance.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Link
              href="/p/0"
              className="group p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 hover:border-sky-500/60 hover:bg-neutral-900/80 transition-all space-y-2 block"
            >
              <div className="flex items-center justify-between text-xs text-neutral-400 font-mono">
                <span>Programme #0</span>
                <span className="text-emerald-400 font-semibold group-hover:translate-x-1 transition-transform">
                  View Rules →
                </span>
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                Open Programme (Demo)
              </h3>
              <p className="text-xs text-neutral-400">
                Explore the reference whistleblower bounty programme, inspection rules, and locked escrow funds.
              </p>
            </Link>

            <Link
              href="/submit/0"
              className="group p-5 rounded-xl border border-sky-800/60 bg-sky-950/20 hover:border-sky-500 hover:bg-sky-950/40 transition-all space-y-2 block"
            >
              <div className="flex items-center justify-between text-xs text-sky-400 font-mono">
                <span>Action</span>
                <span className="font-semibold group-hover:translate-x-1 transition-transform">
                  Start Submission →
                </span>
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                Submit Anonymous Tip
              </h3>
              <p className="text-xs text-neutral-300">
                Clean files, configure dead man&apos;s switch, apply optional AI redaction, and submit anonymously.
              </p>
            </Link>

            <Link
              href="/status"
              className="group p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 hover:border-sky-500/60 hover:bg-neutral-900/80 transition-all space-y-2 block"
            >
              <div className="flex items-center justify-between text-xs text-neutral-400 font-mono">
                <span>Tipster Portal</span>
                <span className="text-sky-400 font-semibold group-hover:translate-x-1 transition-transform">
                  Check →
                </span>
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                Check Tip Status
              </h3>
              <p className="text-xs text-neutral-400">
                Enter your 24-word recovery phrase to view triage outcome, reset switch heartbeat, or retract your tip.
              </p>
            </Link>

            <Link
              href="/claim"
              className="group p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 hover:border-sky-500/60 hover:bg-neutral-900/80 transition-all space-y-2 block"
            >
              <div className="flex items-center justify-between text-xs text-neutral-400 font-mono">
                <span>Payout</span>
                <span className="text-emerald-400 font-semibold group-hover:translate-x-1 transition-transform">
                  Claim →
                </span>
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                Claim Bounty Reward
              </h3>
              <p className="text-xs text-neutral-400">
                Redeem your accepted tip reward to a fresh, unlinked account using your cryptographic proof.
              </p>
            </Link>

            <Link
              href="/panel"
              className="group p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 hover:border-sky-500/60 hover:bg-neutral-900/80 transition-all space-y-2 block"
            >
              <div className="flex items-center justify-between text-xs text-neutral-400 font-mono">
                <span>Governance</span>
                <span className="text-purple-400 font-semibold group-hover:translate-x-1 transition-transform">
                  Review →
                </span>
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                Panel DAO Review
              </h3>
              <p className="text-xs text-neutral-400">
                Panel members unseal evidence keys locally and vote on credibility and bounty distributions.
              </p>
            </Link>

            <Link
              href="/programmes/new"
              className="group p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 hover:border-sky-500/60 hover:bg-neutral-900/80 transition-all space-y-2 block"
            >
              <div className="flex items-center justify-between text-xs text-neutral-400 font-mono">
                <span>Funder</span>
                <span className="text-amber-400 font-semibold group-hover:translate-x-1 transition-transform">
                  Create →
                </span>
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                Create Programme
              </h3>
              <p className="text-xs text-neutral-400">
                Deploy a new bounty programme, configure inspection scopes, deposit reward escrow, and appoint panel members.
              </p>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-800 bg-neutral-900/40 mt-16 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500">
          <p>
            Sealed Tip • MIT Licensed • Built for NEAR Privacy &amp; Private AI
          </p>
          <p className="font-mono text-[11px]">
            Privacy is the product: no logs, no cookies, no tracking.
          </p>
        </div>
      </footer>
    </div>
  );
}
