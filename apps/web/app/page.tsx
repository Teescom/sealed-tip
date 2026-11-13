import Link from "next/link";
import React from "react";

/**
 * Landing page (S-10.2).
 *
 * Every number and every claim on this page is readable in this repository: the cleaning parameters come
 * from `packages/clean/src/host.ts`, the refusals from `gate.ts`, the invariants from `AGENTS.md`, the test
 * counts from `pnpm test`. What we cannot prove yet is stated on the page rather than left out, because a
 * tip line that oversells its own guarantees is the thing this product exists to replace.
 */
export default function LandingPage() {
  return (
    <div className="selection:bg-ask selection:text-paper">
      <section aria-labelledby="hero-title" className="mx-auto w-full max-w-6xl px-4 pt-12 pb-10 sm:px-6 sm:pt-20">
        <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-on-ground-muted">
          NEAR testnet. Hackathon build. Both contracts are live on testnet, and the whole story has
          run there: a tip triaged, resolved by the DAO and paid, and a fired switch released by the keeper.
        </p>
        <h1
          id="hero-title"
          className="display max-w-[16ch] text-[clamp(2.5rem,8vw,4.75rem)] text-paper"
        >
          A tip line whose servers cannot read your files
        </h1>
        <p className="mt-6 max-w-prose text-base leading-relaxed text-on-ground sm:text-lg">
          Evidence is cleaned inside your browser, encrypted before it leaves, and stored as ciphertext. The
          server that receives it keeps no logs, sets no cookies, and loads nothing that is not part of this
          build. A reward is held in escrow on-chain before anyone reads what you sent.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/submit/0"
            className="btn-primary flex min-h-[44px] items-center px-5 text-sm no-underline"
          >
            Submit a tip
          </Link>
          <Link
            href="#what-leaks"
            className="btn-quiet flex min-h-[44px] items-center px-5 text-sm no-underline"
          >
            What gives a document away
          </Link>
        </div>
      </section>

      <section
        aria-labelledby="what-leaks"
        className="card on-paper mx-auto -mt-2 w-full max-w-6xl px-5 py-10 sm:px-10 sm:py-14"
      >
        <h2 id="what-leaks" className="display text-[clamp(1.75rem,5vw,2.75rem)] text-ask">
          What gives a document away
        </h2>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
          Leaked files carry identifying detail their authors never meant to publish. This is what the
          cleaner in this build does with each of it. Nothing here is a promise about formats we do not
          handle.
        </p>

        <dl className="mt-8 space-y-0">
          {STRIPS.map((row) => (
            <div
              key={row.carrier}
              className="grid gap-1 border-t border-rule py-5 last:border-b sm:grid-cols-[1fr_1.4fr] sm:gap-6"
            >
              <dt className="text-sm font-semibold text-ink">{row.carrier}</dt>
              <dd className="space-y-2 text-sm leading-relaxed text-ink-muted">
                <p>{row.action}</p>
                {row.detail ? (
                  <p className="border-l-2 border-rule pl-3 text-[13px]">{row.detail}</p>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 max-w-prose text-[13px] leading-relaxed text-ink-muted">
          Scan mode is a mitigation, not a guarantee. It is the one option on this page that we are willing
          to call imperfect in public, because the alternative is claiming coverage the technique does not
          have.
        </p>
      </section>

      <section
        aria-labelledby="server-side"
        className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6"
      >
        <div className="grid gap-8 md:grid-cols-[1fr_1.5fr] md:gap-12">
          <div>
            <h2 id="server-side" className="display text-[clamp(1.75rem,5vw,2.5rem)] text-paper">
              What the servers hold
            </h2>
            <p className="mt-4 max-w-prose text-sm leading-relaxed text-on-ground-muted">
              Three rules, each enforced by code in this repository rather than by a policy page.
            </p>
          </div>
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              What each Sealed Tip server component can see, and what it keeps
            </caption>
            <thead>
              <tr className="border-b border-rule-dark text-[11px] uppercase tracking-[0.14em] text-on-ground-muted">
                <th scope="col" className="py-3 pr-4 font-medium">
                  Component
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Can it read your evidence
                </th>
                <th scope="col" className="py-3 font-medium">
                  What it stores about you
                </th>
              </tr>
            </thead>
            <tbody className="text-on-ground">
              {SERVERS.map((row) => (
                <tr key={row.name} className="border-b border-rule-dark/70 align-top">
                  <th scope="row" className="py-4 pr-4 font-semibold text-paper">
                    {row.name}
                  </th>
                  <td className="py-4 pr-4">
                    <span className={row.reads ? "text-warn-on-ground" : "text-ok-on-ground"}>
                      {row.reads ? row.reads : "No"}
                    </span>
                  </td>
                  <td className="py-4 text-on-ground-muted">{row.stores}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        aria-labelledby="switch"
        className="card on-paper mx-auto w-full max-w-6xl px-5 py-10 sm:px-10 sm:py-14"
      >
        <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:gap-12">
          <div>
            <h2 id="switch" className="display text-[clamp(1.75rem,5vw,2.5rem)] text-ask">
              If you stop checking in
            </h2>
            <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-muted">
              A tip can carry a dead man&apos;s switch. You pick a check-in interval and a grace period when
              you submit; a keeper service watches the deadline on-chain. If you check in, nothing happens.
              If you do not, the decryption keys go to the panel so the evidence can still be reviewed
              without you.
            </p>
            <ul className="mt-5 space-y-2 text-sm leading-relaxed text-ink-muted">
              <li className="border-l-2 border-rule pl-3">
                The keys are released to the panel, not published. A tip still needs at least two
                non-recused members to open it.
              </li>
              <li className="border-l-2 border-rule pl-3">
                Raw originals are never included unless you tick that box yourself, and the box says what it
                means.
              </li>
              <li className="border-l-2 border-rule pl-3">
                Your identity is a 24-word phrase held in the page&apos;s memory. No account, no wallet, no
                email.
              </li>
            </ul>
          </div>
          <div className="card-inset p-5">
            <h3 className="text-sm font-semibold text-ink">What is proved, and what is not</h3>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
              The whole story has run on testnet against the deployed contracts: a tip submitted through
              one relayer, triaged by a panel member (500 tUSDC reserved), resolved by a 2-of-3 DAO vote
              at 400 tUSDC, and claimed through the other relayer into a fresh implicit account. In a
              second run a fired switch was detected by the keeper in 8.45 s and released three keys.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
              The quote route that would show a cross-chain payout is built, and answers 503 until the
              tip API is given a 1Click key. No cross-chain payout has been made.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="go"
        className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6"
      >
        <h2 id="go" className="display mb-8 text-[clamp(1.75rem,5vw,2.5rem)] text-paper">
          Where you go from here
        </h2>
        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <Link
            href="/submit/0"
            className="panel group flex flex-col justify-between gap-6 p-6 no-underline sm:p-8"
          >
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-on-ground-muted">
                Step 1 of 9
              </p>
              <h3 className="mt-3 text-xl font-semibold text-paper">Submit a tip</h3>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-on-ground-muted">
                Attach files, read the cleaning report, choose whether to run the confidential-computing
                redaction step, arm a switch, and copy your 24 words. The page generates a key pair and
                signs your submission locally; an anonymous relayer puts it on chain.
              </p>
            </div>
            <p className="datum text-xs text-ask-on-ground">
              /submit/[programme]
            </p>
          </Link>

          <ul className="divide-y divide-rule-dark border-y border-rule-dark">
            {DESTINATIONS.map((row) => (
              <li key={row.href}>
                <Link
                  href={row.href}
                  className="group flex min-h-[64px] items-baseline justify-between gap-4 py-4 no-underline"
                >
                  <span>
                    <span className="block text-sm font-semibold text-paper group-hover:text-ask-on-ground">
                      {row.label}
                    </span>
                    <span className="mt-1 block text-[13px] leading-relaxed text-on-ground-muted">
                      {row.who}
                    </span>
                  </span>
                  <span className="datum shrink-0 text-[11px] text-on-ground-muted">{row.path}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="opsec" className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1fr_1.6fr] md:gap-12">
          <h2 id="opsec" className="display text-[clamp(1.5rem,4vw,2.25rem)] text-paper">
            Before you start
          </h2>
          <ul className="space-y-4 text-sm leading-relaxed text-on-ground-muted">
            <li>
              Use Tor Browser or boot Tails.
              <ul className="mt-2 space-y-1 pl-4 text-[13px]">
                <li className="border-l-2 border-rule-dark pl-3">
                  Tor hides your IP from the relay nodes and from whoever owns the exit.
                </li>
                <li className="border-l-2 border-rule-dark pl-3">
                  This site does not publish an onion address yet, so Tor gives you routing privacy, not
                  an untraceable destination.
                </li>
              </ul>
            </li>
            <li>
              Not on your employer&apos;s network, and not on your own phone.
              <ul className="mt-2 space-y-1 pl-4 text-[13px]">
                <li className="border-l-2 border-rule-dark pl-3">
                  Corporate VPNs and captive portals log the connection before it reaches us.
                </li>
              </ul>
            </li>
            <li>
              Close the syncing apps first.
              <ul className="mt-2 space-y-1 pl-4 text-[13px]">
                <li className="border-l-2 border-rule-dark pl-3">
                  Cloud backup and messaging clients re-upload a file you have already cleaned.
                </li>
              </ul>
            </li>
            <li>
              Sign nothing with a full-access key.
              <ul className="mt-2 space-y-1 pl-4 text-[13px]">
                <li className="border-l-2 border-rule-dark pl-3">
                  Tipster actions are signed in the page with the per-tip key, and every relayer call is
                  scoped to one method.
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </section>

      <section aria-labelledby="proof" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        <h2 id="proof" className="display mb-6 text-[clamp(1.5rem,4vw,2.25rem)] text-paper">
          How we know any of this
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Verification status of the claims on this page, measured on the commit this site was built
              from
            </caption>
            <thead>
              <tr className="border-b border-rule-dark text-[11px] uppercase tracking-[0.14em] text-on-ground-muted">
                <th scope="col" className="py-3 pr-4 font-medium">
                  Claim
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Evidence
                </th>
                <th scope="col" className="py-3 font-medium">
                  What it does not prove
                </th>
              </tr>
            </thead>
            <tbody className="text-on-ground">
              {PROOF.map((row) => (
                <tr key={row.claim} className="border-b border-rule-dark/70 align-top">
                  <th scope="row" className="py-4 pr-4 text-left font-semibold text-paper">
                    {row.claim}
                  </th>
                  <td className="datum py-4 pr-4 text-[13px] text-ok-on-ground">{row.evidence}</td>
                  <td className="py-4 text-[13px] leading-relaxed text-on-ground-muted">
                    {row.gap}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const STRIPS = [
  {
    carrier: "PDF metadata and revision history",
    action:
      "Each page is rasterised to pixels at 150 dpi and re-encoded as JPEG at quality 0.85, then rebuilt as a new document. The text layer, the embedded fonts, the producer string, and the creation and modification timestamps do not survive, because there is nothing left to carry them.",
    detail:
      "Rasterising is the only step that removes the things a PDF can hide: invisible text layers, attached files, and the XMP packet that records who saved it last.",
  },
  {
    carrier: "Photo GPS and camera identity",
    action:
      "JPEG and PNG go through decode, canvas, re-encode. EXIF, XMP and IPTC are dropped by that route rather than parsed and filtered, so a field the code has never heard of is still gone.",
    detail:
      "The report names up to 64 metadata tags it found before the rebuild, so you can see what was removed instead of trusting that it was.",
  },
  {
    carrier: "Printer tracking dots",
    action:
      "Optional scan mode converts to grayscale and thresholds the page, which is what breaks up the faint yellow dot grid a colour laser printer stamps on every sheet.",
    detail:
      "It costs you colour and sharpness, and the cleaning report records the mitigation as a warning rather than a fix.",
  },
  {
    carrier: "Formats we cannot clean",
    action:
      "Refused at the byte level. Only PDF, JPEG and PNG are accepted, judged from the file's first bytes, not its name or its MIME type.",
    detail:
      "A .docx is a ZIP, a TIFF is the metadata carrier we cannot re-encode losslessly, and a GIF has frames we would silently throw away. Nothing is handled best effort.",
  },
  {
    carrier: "Your own words",
    action:
      "Optional. If you choose the redaction step, your text goes to a model running inside attested hardware through a stateless proxy, and the enclave returns a report you can verify offline.",
    detail:
      "The curve check on that report is implemented. The signature chain over it needs Intel's collateral and a live enclave, and neither is in this build.",
  },
];

const SERVERS = [
  {
    name: "Blob store",
    reads: false,
    stores: "Ciphertext and nothing else. The route goes through noLogs middleware: no IP, no x-forwarded-for, no body in any log line.",
  },
  {
    name: "Relayer",
    reads: false,
    stores: "A rate-limit counter and the signed action it already forwarded. It sees a transaction, not a document.",
  },
  {
    name: "AI proxy",
    reads: "Only the text you select for redaction",
    stores: "Nothing. It is stateless, and the request never carries a file.",
  },
  {
    name: "Keeper",
    reads: false,
    stores: "The switch deadline and the sealed key bundle. It can hold K_switch and still cannot identify you.",
  },
];

const DESTINATIONS = [
  { href: "/p/0", label: "Programme rules and escrow", who: "Anyone, before submitting", path: "/p/[id]" },
  { href: "/status", label: "Check a tip, keep the switch alive", who: "You, with your 24 words", path: "/status" },
  { href: "/claim", label: "Claim an accepted reward", who: "You, to a fresh address", path: "/claim" },
  { href: "/panel", label: "Triage and vote", who: "Appointed panel members", path: "/panel" },
  { href: "/programmes/new", label: "Fund a programme", who: "Funders", path: "/programmes/new" },
];

const PROOF = [
  {
    claim: "Ciphertext-only storage",
    evidence: "apps/api privacy middleware, 121 tests",
    gap: "The API has never served a real tipster. It runs locally.",
  },
  {
    claim: "Destructive cleaning",
    evidence: "packages/clean, 22 tests, all on fictional fixtures",
    gap: "Tested against fictional documents only, and the browser canvas path is exercised by a Node stand-in.",
  },
  {
    claim: "Contracts enforce escrow and the switch",
    evidence: "258 Rust tests, 176 of them contract units, 55 in a sandbox chain",
    gap: "Exercised on testnet 2026-11-13, not only in tests: submission, a triage reserve of 500 tUSDC, a 2-of-3 DAO resolve at 400 tUSDC, a claim paid into a fresh implicit account, and a switch the keeper released 8.45 s after it fired. `pnpm live` re-runs each stage. There has been no external audit.",
  },
  {
    claim: "No third-party loads",
    evidence: "Per-request CSP nonce, 7 tests, and a headless-Chrome audit of 7 routes at 390 px and 1440 px: one CSP header per document, every inline script nonced, zero console or policy violations, and no origin but this one plus the RPC on the two pages that read chain state",
    gap: "Audited against a local production build. The public Vercel deployment and a Tor-only visit are not covered by that run.",
  },
];
