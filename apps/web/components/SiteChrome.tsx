import Link from "next/link";
import React from "react";

const h = React.createElement;

/**
 * The one header and the one footer.
 *
 * Four routes used to paste the same `<header>` markup with different link lists, which is how `/claim`
 * ended up without a route back to `/panel`. Site chrome belongs in the root layout, so a navigation fix
 * happens once.
 *
 * Below roughly 700px the links fold into a disclosure rather than wrapping into a second row: at 320px a
 * wrapped row of five links puts "Submit Tip" under "Programmes", and the one action the page exists to
 * offer should not be the thing that moves when the viewport narrows. The disclosure is a native
 * `details` element, so it is keyboard-operable and needs no client JavaScript to open.
 */
export function SiteHeader() {
  return h(
    "header",
    { className: "sticky top-0 z-50 bg-ground-2 border-b border-rule-dark" },
    h(
      "div",
      { className: "mx-auto w-full max-w-6xl px-4 sm:px-6" },
      h(
        "div",
        { className: "flex min-h-[4rem] flex-wrap items-center justify-between gap-y-2 py-2" },
        h(
          Link,
          { href: "/", className: "flex items-baseline gap-2 no-underline", "aria-label": "Sealed Tip home" },
          h("span", { className: "display text-2xl text-paper" }, "Sealed Tip"),
          h(
            "span",
            { className: "hidden text-[11px] uppercase tracking-[0.18em] text-on-ground-muted sm:inline" },
            "Anonymous tip line",
          ),
        ),
        h(
          "nav",
          { className: "hidden items-center gap-1 md:flex", "aria-label": "Main" },
          NAV_LINKS.map((link) => navLink(link)),
          h(
            Link,
            {
              href: SUBMIT_LINK.href,
              className: "btn-primary inline-flex min-h-[44px] items-center px-4 text-sm no-underline",
            },
            SUBMIT_LINK.label,
          ),
        ),
        h(
          "details",
          { className: "relative md:hidden" },
          h(
            "summary",
            {
              className:
                "btn-quiet flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-sm",
            },
            "Menu",
          ),
          h(
            "div",
            {
              className:
                "absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] card p-2",
            },
            [...NAV_LINKS, SUBMIT_LINK].map((link) =>
              h(
                Link,
                {
                  key: link.href,
                  href: link.href,
                  className:
                    "flex min-h-[44px] items-center rounded-field px-3 text-sm no-underline " +
                    (link.primary ? "btn-primary mt-1" : "text-ink hover:bg-paper-2"),
                },
                link.label,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

type NavItem = { href: string; label: string; primary?: boolean };

const NAV_LINKS: NavItem[] = [
  { href: "/p/0", label: "Programmes" },
  { href: "/status", label: "Status" },
  { href: "/claim", label: "Claim" },
  { href: "/panel", label: "Panel" },
  { href: "/programmes/new", label: "Fund a programme" },
];

const SUBMIT_LINK: NavItem = { href: "/submit/0", label: "Submit a tip", primary: true };

function navLink(link: { href: string; label: string }) {
  return h(
    Link,
    {
      key: link.href,
      href: link.href,
      className:
        "flex min-h-[44px] items-center rounded-field px-3 text-sm text-on-ground-muted no-underline transition-colors hover:bg-ground-3 hover:text-paper",
    },
    link.label,
  );
}

export function SiteFooter() {
  return h(
    "footer",
    { className: "mt-16 border-t border-rule-dark bg-ground-2" },
    h(
      "div",
      {
        className:
          "mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-on-ground-muted sm:flex-row sm:items-baseline sm:justify-between sm:px-6",
      },
      h(
        "p",
        { className: "max-w-prose" },
        "Sealed Tip is MIT licensed and built for the NEAR Privacy & Private AI track. It runs on testnet.",
      ),
      h(
        "p",
        { className: "datum shrink-0" },
        "No logs. No cookies. No trackers. No third-party scripts.",
      ),
    ),
  );
}
