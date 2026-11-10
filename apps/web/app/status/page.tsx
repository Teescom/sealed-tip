"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  type Tip,
  type TipPublic,
  type TipStatus,
  type ViewClient,
  createViewClient,
} from "@sealedtip/core";
import {
  deriveKeys,
  wordsToSecret,
  type TipsterKeys,
} from "@sealedtip/crypto";

import { createTipApi, type TipApi } from "@/lib/api";
import { readPublicConfig, type PublicConfig } from "@/lib/config";
import { checkinFlow, retractFlow } from "@/lib/submit-flow";

export interface DerivedCredentials {
  readonly secret: Uint8Array;
  readonly claimPubkey: Uint8Array;
  readonly keys: TipsterKeys;
}

/**
  * Derives the tipster's secret and claim pubkey from 24 recovery words and optional passphrase.
    */
export async function credentialsFromWords(
  words: string[] | string,
  passphrase?: string,
): Promise<DerivedCredentials> {
  const wordList = Array.isArray(words)
    ? words.map((w) => w.trim()).filter(Boolean)
    : words.trim().split(/\s+/).filter(Boolean);

  if (wordList.length !== 24) {
    throw new Error(`Expected 24 recovery words, got ${wordList.length}`);
  }

  const secret = wordsToSecret(wordList);
  const keys = await deriveKeys(secret, passphrase);
  return {
    secret,
    claimPubkey: keys.ed25519.publicKey,
    keys,
  };
}

/**
  * Compares expected public key (from chain) with derived public key.
    */
export function matchPubkeys(
  expected: Uint8Array | number[] | null | undefined,
  derived: Uint8Array | number[],
): boolean {
  if (!expected) return true;
  const expArr = Array.from(expected);
  const derArr = Array.from(derived);
  if (expArr.length !== derArr.length) return false;
  return expArr.every((v, i) => v === derArr[i]);
}

/**
  * Checks whether a tip status allows retraction (before DAO decision: Submitted, UnderReview/Triaged, Unfunded).
    */
export function canRetractTip(status: TipStatus | string | null | undefined): boolean {
  if (!status) return false;
  if (typeof status === "string") {
    return (
      status === "Submitted" ||
      status === "UnderReview" ||
      status === "Triaged" ||
      status === "Unfunded"
    );
  }
  return false;
}

export function formatTipStatus(status: TipStatus | string | null | undefined): {
  label: string;
  variant: "blue" | "amber" | "emerald" | "red" | "purple" | "neutral";
  reward?: string;
} {
  if (!status) return { label: "Unknown", variant: "neutral" };
  if (typeof status === "object" && "Accepted" in status) {
    return {
      label: "Accepted",
      variant: "emerald",
      reward: status.Accepted.reward,
    };
  }
  switch (status) {
    case "Submitted":
      return { label: "Submitted", variant: "blue" };
    case "UnderReview":
    case "Triaged":
      return { label: "Triaged (Under Review)", variant: "amber" };
    case "Unfunded":
      return { label: "Unfunded (Credible)", variant: "amber" };
    case "Accepted":
      return { label: "Accepted", variant: "emerald" };
    case "Rejected":
      return { label: "Rejected", variant: "red" };
    case "Dismissed":
      return { label: "Dismissed", variant: "red" };
    case "Settled":
    case "Paid":
      return { label: "Settled", variant: "purple" };
    case "Retracted":
      return { label: "Retracted", variant: "neutral" };
    default:
      return { label: String(status), variant: "neutral" };
  }
}

/**
 * `formatTipStatus` returns its colour key ("emerald", "amber", …") and tests assert on it, so the key
 * stays. This is where that key becomes the product's own token, so a status reads in the same three
 * verdict colours as the rest of the site instead of a leftover Tailwind palette.
 */
const STATUS_TONES: Record<
  "blue" | "amber" | "emerald" | "red" | "purple" | "neutral",
  string
> = {
  blue: "text-ask",
  emerald: "text-ok",
  amber: "text-warn",
  red: "text-bad",
  purple: "text-ask",
  neutral: "text-ink-muted",
};

/** One line of chain data: the label quiet, the value in mono, a hairline under the row. */
function Fact({
  label,
  tone = "text-ink",
  children,
}: {
  label: string;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2">
      <dt className="shrink-0 text-xs text-ink-muted">{label}</dt>
      <dd className={`datum text-right ${tone}`}>{children}</dd>
    </div>
  );
}

export function formatDeadline(ns: string | number | null | undefined): string {  if (!ns) return "None";
  try {
    const ms = Number(BigInt(ns) / 1_000_000n);
    return new Date(ms).toLocaleString();
  } catch {
    return String(ns);
  }
}

export interface UnifiedTip {
  id: number;
  programme_id: number;
  status: TipStatus;
  submitted_at: string;
  switch_deadline: string | null;
  switch_triggered: boolean;
  nonce: number;
  claim_pubkey: number[] | null;
  switch_interval?: string | undefined;
  switch_grace?: string | undefined;
}

export async function fetchTipDetails(
  views: ViewClient,
  tipId: number,
): Promise<UnifiedTip | null> {
  const getTipPublic = (views as unknown as Record<string, unknown>).getTipPublic ??
    (views as unknown as Record<string, unknown>).get_tip_public;
  const getTipForPanel = (views as unknown as Record<string, unknown>).getTipForPanel ??
    (views as unknown as Record<string, unknown>).get_tip_for_panel;

  let publicTip: TipPublic | (TipPublic & { nonce?: number; claim_pubkey?: number[] }) | null = null;
  if (typeof getTipPublic === "function") {
    publicTip = (await (getTipPublic as (id: number) => Promise<TipPublic | null>).call(views, tipId)) as
      | TipPublic
      | null;
  }

  let panelTip: Tip | null = null;
  if (typeof getTipForPanel === "function") {
    try {
      panelTip = (await (getTipForPanel as (id: number) => Promise<Tip | null>).call(views, tipId)) as Tip | null;
    } catch {
      // panel call may be restricted or unavailable
    }
  }

  if (!publicTip && !panelTip) {
    return null;
  }

  const rawPublic = (publicTip ?? {}) as Record<string, unknown>;
  const rawPanel = (panelTip ?? {}) as Record<string, unknown>;

  const status = (rawPublic.status ?? rawPanel.status) as TipStatus;
  const programme_id = Number(rawPublic.programme_id ?? rawPanel.programme_id ?? 0);
  const submitted_at = String(rawPublic.submitted_at ?? rawPanel.submitted_at ?? "0");
  const switchObj = panelTip?.switch ?? null;
  const switch_deadline = (rawPublic.switch_deadline as string | null) ?? switchObj?.next_deadline ?? null;
  const switch_triggered = Boolean(rawPublic.switch_triggered ?? switchObj?.triggered);

  const nonce = Number(rawPanel.nonce ?? rawPublic.nonce ?? 0);
  const claim_pubkey = (rawPanel.claim_pubkey as number[] | null) ??
    (rawPublic.claim_pubkey as number[] | null) ??
    null;

  return {
    id: tipId,
    programme_id,
    status,
    submitted_at,
    switch_deadline,
    switch_triggered,
    nonce,
    claim_pubkey,
    switch_interval: switchObj?.interval,
    switch_grace: switchObj?.grace,
  };
}

function StatusContent() {
  const searchParams = useSearchParams();
  const initialTipId = searchParams.get("tipId") ?? "";

  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [tipIdInput, setTipIdInput] = useState(initialTipId);
  const [wordsInput, setWordsInput] = useState("");
  const [passphraseInput, setPassphraseInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentialWarning, setCredentialWarning] = useState<string | null>(null);

  const [tip, setTip] = useState<UnifiedTip | null>(null);
  const [creds, setCreds] = useState<DerivedCredentials | null>(null);

  // Action states
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null);
  const [retractLoading, setRetractLoading] = useState(false);
  const [retractMessage, setRetractMessage] = useState<string | null>(null);

  useEffect(() => {
    const res = readPublicConfig({
      NEXT_PUBLIC_NEAR_NETWORK: process.env.NEXT_PUBLIC_NEAR_NETWORK,
      NEXT_PUBLIC_NEAR_RPC_URL: process.env.NEXT_PUBLIC_NEAR_RPC_URL,
      NEXT_PUBLIC_SEALEDTIP_CONTRACT: process.env.NEXT_PUBLIC_SEALEDTIP_CONTRACT,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
      NEXT_PUBLIC_TOKEN_CONTRACT: process.env.NEXT_PUBLIC_TOKEN_CONTRACT,
    });
    if (res.ok) {
      setConfig(res.config);
    } else {
      // Fallback default config for offline/sandbox environments
      setConfig({
        network: "testnet",
        rpcUrl: "https://rpc.testnet.near.org",
        contractId: "sealedtip.testnet",
        apiUrl: "http://localhost:8787",
        tokenContract: null,
      });
    }
  }, []);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCredentialWarning(null);
    setCheckinMessage(null);
    setRetractMessage(null);

    const tipIdNum = Number.parseInt(tipIdInput.trim(), 10);
    if (Number.isNaN(tipIdNum) || tipIdNum < 0) {
      setError("Please enter a valid non-negative Tip ID number.");
      return;
    }

    setLoading(true);
    try {
      // 1. Derive credentials from recovery words
      const derived = await credentialsFromWords(wordsInput, passphraseInput || undefined);
      setCreds(derived);

      // 2. Fetch tip from chain
      if (!config) {
        throw new Error("Client configuration not loaded.");
      }
      const views = createViewClient(config.rpcUrl, config.contractId);
      const fetched = await fetchTipDetails(views, tipIdNum);

      if (!fetched) {
        setError(`Tip #${tipIdNum} was not found on-chain.`);
        setTip(null);
        setLoading(false);
        return;
      }

      setTip(fetched);

      // 3. Validate claim_pubkey against derived key
      if (fetched.claim_pubkey) {
        const matches = matchPubkeys(fetched.claim_pubkey, derived.claimPubkey);
        if (!matches) {
          setCredentialWarning("Tip credentials do not match this Tip ID");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTip(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckin = async () => {
    if (!tip || !creds || !config) return;
    setCheckinLoading(true);
    setError(null);
    try {
      const api: TipApi = createTipApi(config.apiUrl);
      const res = await checkinFlow(
        {
          tipId: tip.id,
          nonce: tip.nonce,
          secret: creds.secret,
          passphrase: passphraseInput || undefined,
        },
        { api, contractId: config.contractId },
      );
      setCheckinMessage(`Checked in! Relayer queued until ${new Date(res.queuedUntil).toLocaleString()}`);
      setTip((prev) => (prev ? { ...prev, nonce: prev.nonce + 1 } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckinLoading(false);
    }
  };

  const handleRetract = async () => {
    if (!tip || !creds || !config) return;
    const confirmed = window.confirm(
      `Are you sure you want to retract Tip #${tip.id}? This will withdraw the tip from review and cannot be undone.`,
    );
    if (!confirmed) return;

    setRetractLoading(true);
    setError(null);
    try {
      const api: TipApi = createTipApi(config.apiUrl);
      const res = await retractFlow(
        {
          tipId: tip.id,
          nonce: tip.nonce,
          secret: creds.secret,
          passphrase: passphraseInput || undefined,
        },
        { api, contractId: config.contractId },
      );
      setRetractMessage(`Tip retracted! Relayer queued until ${new Date(res.queuedUntil).toLocaleString()}`);
      setTip((prev) => (prev ? { ...prev, status: "Retracted", nonce: prev.nonce + 1 } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetractLoading(false);
    }
  };

  const wordCount = wordsInput
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  const statusInfo = tip ? formatTipStatus(tip.status) : null;
  const isRetractable = tip ? canRetractTip(tip.status) : false;
  const isSwitchArmed = Boolean(tip && tip.switch_deadline !== null);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="card on-paper space-y-6 p-6 sm:p-8">
        <div>
          <h1 className="display text-[clamp(1.75rem,5vw,2.25rem)] text-ask">Check tip status</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Enter your Tip ID and 24-word recovery phrase to view live status, check in with the dead man&apos;s switch,
            or retract before review. Key verification runs entirely in your browser.
          </p>
        </div>

        {/* Lookup Form */}
        <form onSubmit={handleLookup} className="card-inset space-y-5 p-5">
          <div>
            <label htmlFor="tipId" className="block text-xs font-medium text-ink-muted mb-1">
              Tip ID
            </label>
            <input
              id="tipId"
              type="number"
              min="0"
              required
              value={tipIdInput}
              onChange={(e) => setTipIdInput(e.target.value)}
              placeholder="e.g. 0"
              className="w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted font-mono"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="words" className="block text-xs font-medium text-ink-muted">
                24 Recovery Words
              </label>
              <span
                className={`text-xs font-mono ${
                  wordCount === 24 ? "text-ok" : wordCount > 0 ? "text-warn" : "text-ink-muted"
                }`}
              >
                {wordCount} / 24 words
              </span>
            </div>
            <textarea
              id="words"
              required
              rows={3}
              value={wordsInput}
              onChange={(e) => setWordsInput(e.target.value)}
              placeholder="paste your 24 words separated by spaces…"
              className="w-full bg-paper border border-edge rounded-field p-3 text-sm text-ink placeholder:text-ink-muted font-mono"
            />
          </div>

          <div>
            <label htmlFor="passphrase" className="block text-xs font-medium text-ink-muted mb-1">
              Passphrase <span className="text-ink-muted normal-case font-normal">(optional, if used during submit)</span>
            </label>
            <input
              id="passphrase"
              type="password"
              value={passphraseInput}
              onChange={(e) => setPassphraseInput(e.target.value)}
              placeholder="leave empty if none was set"
              className="w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading the tip…" : "Check the status"}
          </button>
        </form>

        {/* Global Error Banner */}
        {error && (
          <p className="mt-6 border-l-4 border-l-bad bg-paper p-4 text-sm text-bad">{error}</p>
        )}

        {/* Credential Warning Banner */}
        {credentialWarning && (
          <div className="mt-6 border-l-4 border-l-warn bg-paper p-4">
            <h2 className="text-sm font-semibold text-ink">These words do not match tip #{tip?.id}</h2>
            <p className="mt-1 text-xs text-ink-muted">
              The public key derived from these 24 words is not the claim key recorded for this tip. Check the tip ID
              and the passphrase, if you used one.
            </p>
          </div>
        )}

        {/* What the chain holds about this tip. Facts in a list, one hairline between groups. */}
        {tip && (
          <div className="space-y-5 border-t border-rule pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <h2 className="text-xs text-ink-muted">Tip</h2>
                <p className="datum text-2xl font-semibold text-ink">#{tip.id}</p>
              </div>
              {statusInfo && (
                <p className="text-right">
                  <span className="block text-xs text-ink-muted">Status</span>
                  <span className={`text-sm font-semibold ${STATUS_TONES[statusInfo.variant]}`}>
                    {statusInfo.label}
                  </span>
                </p>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2">
              <Fact label="Programme">
                <Link href={`/p/${tip.programme_id}`} className="datum text-ask hover:underline">
                  Programme #{tip.programme_id}
                </Link>
              </Fact>
              <Fact label="Submitted">{formatDeadline(tip.submitted_at)}</Fact>
              <Fact label="Action nonce">{tip.nonce}</Fact>
              {statusInfo?.reward ? (
                <Fact label="Approved reward" tone="text-ok">
                  {statusInfo.reward} token units
                </Fact>
              ) : null}
              <Fact label="Dead man&apos;s switch" tone={isSwitchArmed ? "text-ok" : "text-ink-muted"}>
                {isSwitchArmed ? "Armed" : "Not armed"}
              </Fact>
              <Fact label="Check in by">{formatDeadline(tip.switch_deadline)}</Fact>
              {tip.switch_interval ? (
                <Fact label="Check-in interval">{tip.switch_interval} ns</Fact>
              ) : null}
              {tip.switch_triggered ? (
                <Fact label="Release" tone="text-bad">
                  Deadline passed. Keys were released to the panel.
                </Fact>
              ) : null}
            </dl>

            {statusInfo?.label === "Accepted" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
                <p className="text-sm text-ok">The panel accepted this tip. Its bounty is reserved for you.</p>
                <Link
                  href={`/claim?tipId=${tip.id}`}
                  className="btn-primary inline-flex min-h-[48px] items-center justify-center px-5 text-sm"
                >
                  Claim the reward
                </Link>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-rule pt-4 sm:flex-row">
              <button
                type="button"
                onClick={handleCheckin}
                disabled={!isSwitchArmed || tip.switch_triggered || checkinLoading}
                aria-label="Check in with dead man's switch to reset timer"
                className="btn-primary inline-flex min-h-[48px] items-center justify-center px-5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                {checkinLoading ? "Checking in…" : "Check in with the switch"}
              </button>

              <button
                type="button"
                onClick={handleRetract}
                disabled={!isRetractable || retractLoading}
                aria-label="Retract this anonymous tip before review"
                className="btn-secondary px-5 text-sm text-bad disabled:cursor-not-allowed disabled:opacity-40"
              >
                {retractLoading ? "Retracting…" : "Retract the tip"}
              </button>
            </div>

            {checkinMessage ? <p className="text-sm text-ok">{checkinMessage}</p> : null}
            {retractMessage ? <p className="text-sm text-ink-muted">{retractMessage}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-3xl px-4 py-10 text-sm text-on-ground-muted sm:px-6">Loading status…</p>}>
      <StatusContent />
    </Suspense>
  );
}
