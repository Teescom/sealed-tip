"use client";

import { Suspense, useEffect, useState } from "react";
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

export function formatDeadline(ns: string | number | null | undefined): string {
  if (!ns) return "None";
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
    <div className="min-h-screen bg-neutral-950 text-neutral-100 selection:bg-sky-500/30 selection:text-sky-200">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
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
          </Link>

          <nav aria-label="Navigation" className="flex items-center gap-3 sm:gap-4 text-xs font-medium">
            <Link href="/p/0" className="text-neutral-300 hover:text-white transition-colors">
              Programmes
            </Link>
            <Link href="/status" className="text-sky-400 font-semibold transition-colors">
              Check Status
            </Link>
            <Link href="/claim" className="text-neutral-300 hover:text-white transition-colors">
              Claim Reward
            </Link>
            <Link href="/panel" className="text-neutral-300 hover:text-white transition-colors hidden md:inline-block">
              Panel DAO
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white">Check Tip Status</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Enter your Tip ID and 24-word recovery phrase to view live status, check in with the dead man&apos;s switch,
            or retract before review. Key verification runs entirely in your browser.
          </p>
        </div>

        {/* Lookup Form */}
        <form onSubmit={handleLookup} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-5">
          <div>
            <label htmlFor="tipId" className="block text-xs font-medium uppercase tracking-wider text-neutral-300 mb-1">
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
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="words" className="block text-xs font-medium uppercase tracking-wider text-neutral-300">
                24 Recovery Words
              </label>
              <span
                className={`text-xs font-mono ${
                  wordCount === 24 ? "text-emerald-400" : wordCount > 0 ? "text-amber-400" : "text-neutral-500"
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
              placeholder="paste your 24 words separated by spaces..."
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <label htmlFor="passphrase" className="block text-xs font-medium uppercase tracking-wider text-neutral-300 mb-1">
              Passphrase <span className="text-neutral-500 normal-case font-normal">(optional, if used during submit)</span>
            </label>
            <input
              id="passphrase"
              type="password"
              value={passphraseInput}
              onChange={(e) => setPassphraseInput(e.target.value)}
              placeholder="leave empty if none was set"
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-sm transition disabled:opacity-50"
          >
            {loading ? "Verifying Credentials & Loading Tip..." : "Check Status"}
          </button>
        </form>

        {/* Global Error Banner */}
        {error && (
          <div className="mt-6 rounded-lg border border-red-500/40 bg-red-950/20 p-4 text-sm text-red-200">
            <span className="font-semibold block mb-0.5">Error</span>
            {error}
          </div>
        )}

        {/* Credential Warning Banner */}
        {credentialWarning && (
          <div className="mt-6 rounded-lg border border-amber-500/50 bg-amber-950/30 p-4 text-sm text-amber-200">
            <div className="font-semibold text-amber-300 flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Tip credentials do not match this Tip ID</span>
            </div>
            <p className="mt-1 text-xs text-amber-300/90">
              The public key derived from these 24 words does not match the claim public key on record for this tip.
              Check your Tip ID and passphrase.
            </p>
          </div>
        )}

        {/* Tip Status Results */}
        {tip && (
          <div className="mt-8 space-y-6">
            {/* Overview Card */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-4 mb-4">
                <div>
                  <span className="text-xs uppercase tracking-wider text-neutral-400">Tip Reference</span>
                  <div className="text-xl font-bold font-mono text-white">Tip #{tip.id}</div>
                </div>

                {statusInfo && (
                  <div>
                    <span className="text-xs uppercase tracking-wider text-neutral-400 block mb-1">Current Status</span>
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                        statusInfo.variant === "emerald"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                          : statusInfo.variant === "amber"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          : statusInfo.variant === "blue"
                          ? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                          : statusInfo.variant === "purple"
                          ? "bg-purple-500/10 text-purple-400 border border-purple-500/30"
                          : statusInfo.variant === "red"
                          ? "bg-red-500/10 text-red-400 border border-red-500/30"
                          : "bg-neutral-800 text-neutral-300 border border-neutral-700"
                      }`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-neutral-400 text-xs block">Programme ID</span>
                  <Link
                    href={`/p/${tip.programme_id}`}
                    className="text-sky-400 hover:underline font-mono font-medium"
                  >
                    Programme #{tip.programme_id}
                  </Link>
                </div>

                <div>
                  <span className="text-neutral-400 text-xs block">Submitted At</span>
                  <span className="font-mono text-neutral-200">{formatDeadline(tip.submitted_at)}</span>
                </div>

                {statusInfo?.reward && (
                  <div>
                    <span className="text-neutral-400 text-xs block">Approved Reward</span>
                    <span className="font-mono text-emerald-400 font-semibold">{statusInfo.reward} token units</span>
                  </div>
                )}

                <div>
                  <span className="text-neutral-400 text-xs block">Tip Action Nonce</span>
                  <span className="font-mono text-neutral-200">{tip.nonce}</span>
                </div>
              </div>

              {/* Accepted reward claim link */}
              {statusInfo?.label === "Accepted" && (
                <div className="mt-5 pt-4 border-t border-neutral-800 flex items-center justify-between">
                  <span className="text-xs text-emerald-400 font-medium">
                    This tip has been accepted for reward payment!
                  </span>
                  <Link
                    href={`/claim?tipId=${tip.id}`}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                  >
                    Claim Reward &rarr;
                  </Link>
                </div>
              )}
            </div>

            {/* Dead Man's Switch Card */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300 mb-4 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                Dead Man&apos;s Switch &amp; Deadlines
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <span className="text-neutral-400 text-xs block">Switch Armed</span>
                  <span
                    className={`font-medium ${
                      isSwitchArmed ? "text-emerald-400" : "text-neutral-500"
                    }`}
                  >
                    {isSwitchArmed ? "Armed & Active" : "Not Armed"}
                  </span>
                </div>

                <div>
                  <span className="text-neutral-400 text-xs block">Switch Triggered</span>
                  <span
                    className={`font-medium ${
                      tip.switch_triggered ? "text-red-400 font-bold" : "text-neutral-300"
                    }`}
                  >
                    {tip.switch_triggered ? "TRIGGERED (Keys Released)" : "No (Normal)"}
                  </span>
                </div>

                <div>
                  <span className="text-neutral-400 text-xs block">Current Switch Deadline</span>
                  <span className="font-mono text-neutral-200">{formatDeadline(tip.switch_deadline)}</span>
                </div>

                {tip.switch_interval && (
                  <div>
                    <span className="text-neutral-400 text-xs block">Check-in Interval (ns)</span>
                    <span className="font-mono text-neutral-400 text-xs">{tip.switch_interval}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-neutral-800 flex flex-wrap gap-3 items-center">
                <button
                  type="button"
                  onClick={handleCheckin}
                  disabled={!isSwitchArmed || tip.switch_triggered || checkinLoading}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {checkinLoading ? "Checking in..." : "Check In with Switch"}
                </button>

                <button
                  type="button"
                  onClick={handleRetract}
                  disabled={!isRetractable || retractLoading}
                  className="px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-500 text-white text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {retractLoading ? "Retracting..." : "Retract Tip"}
                </button>
              </div>

              {/* Action confirmations */}
              {checkinMessage && (
                <div className="mt-4 rounded-lg bg-emerald-950/30 border border-emerald-500/40 p-3 text-xs text-emerald-300">
                  {checkinMessage}
                </div>
              )}

              {retractMessage && (
                <div className="mt-4 rounded-lg bg-neutral-800 border border-neutral-700 p-3 text-xs text-neutral-200">
                  {retractMessage}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-neutral-950 p-8 text-neutral-400">Loading Status...</div>}>
      <StatusContent />
    </Suspense>
  );
}
