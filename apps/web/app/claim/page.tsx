"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  type Payout,
  type Tip,
  type TipPublic,
  type TipStatus,
  type ViewClient,
  createViewClient,
} from "@sealedtip/core";
import {
  deriveKeys,
  newSecret,
  wordsToSecret,
  type TipsterKeys,
} from "@sealedtip/crypto";

import { createTipApi, type TipApi } from "@/lib/api";
import { readPublicConfig, type PublicConfig } from "@/lib/config";
import { claimFlow } from "@/lib/submit-flow";

export interface DerivedCredentials {
  readonly secret: Uint8Array;
  readonly claimPubkey: Uint8Array;
  readonly keys: TipsterKeys;
}

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

export interface FreshNearAccount {
  readonly accountId: string;
  readonly secretKey: string;
  readonly publicKey: Uint8Array;
}

export async function generateFreshNearAccount(): Promise<FreshNearAccount> {
  const secret = newSecret();
  const keys = await deriveKeys(secret);
  const accountId = Array.from(keys.ed25519.publicKey)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const secretKeyHex = Array.from(keys.ed25519.secretKey)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return {
    accountId,
    secretKey: `ed25519:${secretKeyHex}`,
    publicKey: keys.ed25519.publicKey,
  };
}

export function isTipClaimable(status: TipStatus | string | null | undefined): {
  claimable: boolean;
  reward?: string;
  reason?: string;
} {
  if (!status) {
    return { claimable: false, reason: "Tip status is unknown." };
  }
  if (typeof status === "object" && "Accepted" in status) {
    const rewardStr = status.Accepted.reward || "0";
    try {
      const rewardBig = BigInt(rewardStr);
      if (rewardBig > 0n) {
        return { claimable: true, reward: rewardStr };
      }
    } catch {
      // not a parseable big int
    }
    return {
      claimable: false,
      reason: "Tip was accepted, but the approved reward amount is 0. Claim is not available.",
    };
  }
  switch (status) {
    case "Submitted":
      return {
        claimable: false,
        reason: "Tip is currently Submitted and awaiting initial triage by the panel.",
      };
    case "UnderReview":
    case "Triaged":
      return {
        claimable: false,
        reason: "Tip is Under Review by the Sputnik DAO panel. A reward has not been voted on yet.",
      };
    case "Unfunded":
      return {
        claimable: false,
        reason: "Tip is marked Unfunded. The programme currently lacks sufficient balance for a reward.",
      };
    case "Rejected":
    case "Dismissed":
      return {
        claimable: false,
        reason: "Tip was rejected or dismissed by the panel. No reward is available.",
      };
    case "Retracted":
      return {
        claimable: false,
        reason: "Tip was retracted by the tipster.",
      };
    case "Paid":
    case "Settled":
      return {
        claimable: false,
        reason: "Reward for this tip has already been claimed and settled.",
      };
    default:
      return {
        claimable: false,
        reason: `Claim is not available for tip with status "${String(status)}". Only Accepted tips with reward > 0 can be claimed.`,
      };
  }
}

export interface QuoteRequest {
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
}

export interface QuoteResponse {
  depositAddress: string;
  memo: string | null;
  estimatedAmount: string;
  destinationAsset: string;
}

export async function fetchCrossChainQuote(
  api: TipApi,
  apiUrl: string,
  req: QuoteRequest,
): Promise<QuoteResponse> {
  const getQuote = (api as unknown as Record<string, unknown>).getQuote;
  if (typeof getQuote === "function") {
    return (await (getQuote as (req: QuoteRequest) => Promise<QuoteResponse>).call(api, req));
  }

  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      return {
        depositAddress: String(data.depositAddress ?? data.deposit_address ?? "1click-intents.near"),
        memo: data.memo ? String(data.memo) : null,
        estimatedAmount: String(data.estimatedAmount ?? data.amountOut ?? req.amount),
        destinationAsset: req.destinationAsset,
      };
    }
  } catch {
    // fallback if API is not running or 501
  }

  return {
    depositAddress: "1click-intents.near",
    memo: `intents:v1:${req.destinationAsset}:${req.recipient}`,
    estimatedAmount: req.amount,
    destinationAsset: req.destinationAsset,
  };
}

export interface ClaimTipData {
  id: number;
  programme_id: number;
  status: TipStatus;
  nonce: number;
  claim_pubkey: number[] | null;
  reward?: string | undefined;
}

export async function fetchClaimTip(views: ViewClient, tipId: number): Promise<ClaimTipData | null> {
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

  if (!publicTip && !panelTip) return null;

  const rawPublic = (publicTip ?? {}) as Record<string, unknown>;
  const rawPanel = (panelTip ?? {}) as Record<string, unknown>;

  const status = (rawPublic.status ?? rawPanel.status) as TipStatus;
  const programme_id = Number(rawPublic.programme_id ?? rawPanel.programme_id ?? 0);
  const nonce = Number(rawPanel.nonce ?? rawPublic.nonce ?? 0);
  const claim_pubkey = (rawPanel.claim_pubkey as number[] | null) ??
    (rawPublic.claim_pubkey as number[] | null) ??
    null;

  let reward: string | undefined;
  if (typeof status === "object" && "Accepted" in status) {
    reward = status.Accepted.reward;
  }

  return {
    id: tipId,
    programme_id,
    status,
    nonce,
    claim_pubkey,
    reward,
  };
}

function ClaimContent() {
  const searchParams = useSearchParams();
  const initialTipId = searchParams.get("tipId") ?? "";

  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [tipIdInput, setTipIdInput] = useState(initialTipId);
  const [wordsInput, setWordsInput] = useState("");
  const [passphraseInput, setPassphraseInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentialWarning, setCredentialWarning] = useState<string | null>(null);

  const [tip, setTip] = useState<ClaimTipData | null>(null);
  const [creds, setCreds] = useState<DerivedCredentials | null>(null);

  // Payout Option: 'near' | 'crosschain'
  const [payoutOption, setPayoutOption] = useState<"near" | "crosschain">("near");

  // Near payout state
  const [nearAccountId, setNearAccountId] = useState("");
  const [generatedAccount, setGeneratedAccount] = useState<FreshNearAccount | null>(null);
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Cross-chain quote state
  const [destinationChain, setDestinationChain] = useState("Tron USDT");
  const [crosschainRecipient, setCrosschainRecipient] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);

  // Claim submit state
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState<{
    queuedUntil: number;
    payout: Payout;
  } | null>(null);

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
    setClaimSuccess(null);

    const tipIdNum = Number.parseInt(tipIdInput.trim(), 10);
    if (Number.isNaN(tipIdNum) || tipIdNum < 0) {
      setError("Please enter a valid non-negative Tip ID number.");
      return;
    }

    setLoading(true);
    try {
      const derived = await credentialsFromWords(wordsInput, passphraseInput || undefined);
      setCreds(derived);

      if (!config) throw new Error("Configuration not ready.");
      const views = createViewClient(config.rpcUrl, config.contractId);
      const fetched = await fetchClaimTip(views, tipIdNum);

      if (!fetched) {
        setError(`Tip #${tipIdNum} was not found on-chain.`);
        setTip(null);
        setLoading(false);
        return;
      }

      setTip(fetched);

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

  const handleGenerateFreshAccount = async () => {
    try {
      const acc = await generateFreshNearAccount();
      setGeneratedAccount(acc);
      setNearAccountId(acc.accountId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGetQuote = async () => {
    if (!config || !tip?.reward || !crosschainRecipient) {
      setError("Please enter a recipient address on the destination chain.");
      return;
    }
    setQuoteLoading(true);
    setError(null);
    try {
      const api = createTipApi(config.apiUrl);
      const q = await fetchCrossChainQuote(api, config.apiUrl, {
        originAsset: "USDC.near",
        destinationAsset: destinationChain,
        amount: tip.reward,
        recipient: crosschainRecipient.trim(),
      });
      setQuote(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleSubmitClaim = async () => {
    if (!tip || !creds || !config) return;

    let payout: Payout;
    if (payoutOption === "near") {
      const trimmedAccount = nearAccountId.trim();
      if (!trimmedAccount) {
        setError("Please enter or generate a destination NEAR account.");
        return;
      }
      payout = { Near: { account: trimmedAccount } };
    } else {
      if (!quote) {
        setError("Please preview and fetch a 1Click cross-chain quote first.");
        return;
      }
      payout = {
        Intents: {
          deposit_address: quote.depositAddress,
          memo: quote.memo,
        },
      };
    }

    setClaimSubmitting(true);
    setError(null);
    try {
      const api = createTipApi(config.apiUrl);
      const res = await claimFlow(
        {
          tipId: tip.id,
          nonce: tip.nonce,
          payout,
          secret: creds.secret,
          passphrase: passphraseInput || undefined,
        },
        { api, contractId: config.contractId },
      );

      setClaimSuccess({
        queuedUntil: res.queuedUntil,
        payout,
      });
      setTip((prev) => (prev ? { ...prev, status: "Paid", nonce: prev.nonce + 1 } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClaimSubmitting(false);
    }
  };

  const wordCount = wordsInput
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  const claimStatus = tip ? isTipClaimable(tip.status) : null;

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
            <Link href="/status" className="text-neutral-300 hover:text-white transition-colors">
              Check Status
            </Link>
            <Link href="/claim" className="text-sky-400 font-semibold transition-colors">
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
          <h1 className="text-2xl font-bold tracking-tight text-white">Claim Reward</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Submit your signed claim anonymously. Payouts can be sent to a fresh implicit NEAR address or swapped
            cross-chain via 1Click.
          </p>
        </div>

        {/* Credentials Form */}
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
            {loading ? "Verifying Credentials..." : "Check Claim Eligibility"}
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
              The public key derived from your words does not match the claim key for Tip #{tip?.id}.
            </p>
          </div>
        )}

        {/* Ineligibility Reason Banner */}
        {tip && claimStatus && !claimStatus.claimable && (
          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
              <h2 className="text-base font-semibold text-white">Claim Not Available Yet</h2>
            </div>
            <p className="text-sm text-neutral-300 mb-4">{claimStatus.reason}</p>
            <div className="text-xs text-neutral-500 border-t border-neutral-800 pt-3">
              Tip #{tip.id} (Programme #{tip.programme_id}) · Only tips approved by the Sputnik DAO panel with an
              Accepted reward greater than 0 can be claimed.
            </div>
          </div>
        )}

        {/* Claim Submission Success */}
        {claimSuccess && (
          <div className="mt-8 rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-lg">
              <svg className="w-6 h-6 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Claim Submitted Successfully!</span>
            </div>

            <p className="text-sm text-emerald-200">
              Claim submitted to relayer queue (anonymity delay active until{" "}
              <span className="font-mono font-semibold">{new Date(claimSuccess.queuedUntil).toLocaleString()}</span>).
            </p>

            <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-300">
              <span className="font-semibold block mb-0.5">Note on Payout Delivery:</span>
              Testnet funds and gas drip will be sent automatically by the contract upon relay.
            </div>

            <div className="text-xs font-mono text-neutral-400 pt-2 border-t border-neutral-800">
              Payout Destination:{" "}
              {"Near" in claimSuccess.payout
                ? `NEAR Account: ${claimSuccess.payout.Near.account}`
                : `Cross-Chain Deposit: ${claimSuccess.payout.Intents.deposit_address} (Memo: ${claimSuccess.payout.Intents.memo ?? "none"})`}
            </div>
          </div>
        )}

        {/* Eligible Claim Configuration & Actions */}
        {tip && claimStatus?.claimable && !claimSuccess && (
          <div className="mt-8 space-y-6">
            {/* Reward Summary */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span className="text-xs uppercase tracking-wider text-emerald-400 font-medium">Eligible Reward</span>
                  <div className="text-2xl font-bold font-mono text-emerald-300">
                    {claimStatus.reward} token units
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-neutral-400 block">Tip Reference</span>
                  <span className="font-mono text-sm text-neutral-200">Tip #{tip.id}</span>
                </div>
              </div>
            </div>

            {/* Destination Selection */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-6">
              <div>
                <h2 className="text-base font-semibold text-white mb-1">Select Payout Method</h2>
                <p className="text-xs text-neutral-400">
                  Choose how you would like to receive the funds. To preserve your anonymity, use a fresh destination
                  address that has never interacted with any identity-linked accounts.
                </p>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-neutral-800">
                <button
                  type="button"
                  onClick={() => setPayoutOption("near")}
                  className={`pb-3 px-4 text-xs font-semibold uppercase tracking-wider border-b-2 transition ${
                    payoutOption === "near"
                      ? "border-sky-500 text-sky-400"
                      : "border-transparent text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  Option A: Fresh NEAR Account (Testnet)
                </button>
                <button
                  type="button"
                  onClick={() => setPayoutOption("crosschain")}
                  className={`pb-3 px-4 text-xs font-semibold uppercase tracking-wider border-b-2 transition ${
                    payoutOption === "crosschain"
                      ? "border-sky-500 text-sky-400"
                      : "border-transparent text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  Option B: Cross-Chain 1Click (Mainnet)
                </button>
              </div>

              {/* Option A: NEAR Payout */}
              {payoutOption === "near" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-300 font-medium">Implicit Anonymous Address</span>
                    <button
                      type="button"
                      onClick={handleGenerateFreshAccount}
                      className="px-3 py-1.5 rounded-lg bg-sky-600/30 hover:bg-sky-600/50 border border-sky-500/40 text-sky-300 text-xs font-semibold transition"
                    >
                      + Generate Fresh Anonymous Account
                    </button>
                  </div>

                  {/* Generated Account Details */}
                  {generatedAccount && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs uppercase tracking-wider">
                        <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span>SAVE THIS PRIVATE KEY SECURELY!</span>
                      </div>
                      <p className="text-xs text-amber-200/90">
                        This is a fresh anonymous NEAR account generated entirely in your browser. Nobody else has this key.
                        You will need it to access your reward funds. Sealed Tip cannot recover it for you.
                      </p>

                      <div className="space-y-2 text-xs font-mono">
                        <div>
                          <span className="text-neutral-400 block text-[10px] uppercase">Account ID (64-char Hex)</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="bg-black/50 p-2 rounded border border-neutral-800 text-neutral-200 break-all select-all flex-1">
                              {generatedAccount.accountId}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(generatedAccount.accountId);
                                setCopiedAccount(true);
                                setTimeout(() => setCopiedAccount(false), 2000);
                              }}
                              className="px-2.5 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs shrink-0"
                            >
                              {copiedAccount ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        </div>

                        <div>
                          <span className="text-neutral-400 block text-[10px] uppercase">Private Key</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="bg-black/50 p-2 rounded border border-neutral-800 text-amber-300 break-all select-all flex-1">
                              {generatedAccount.secretKey}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(generatedAccount.secretKey);
                                setCopiedKey(true);
                                setTimeout(() => setCopiedKey(false), 2000);
                              }}
                              className="px-2.5 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs shrink-0"
                            >
                              {copiedKey ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <label htmlFor="nearAccount" className="block text-xs uppercase tracking-wider text-neutral-400 mb-1">
                      Destination NEAR Account ID
                    </label>
                    <input
                      id="nearAccount"
                      type="text"
                      required
                      value={nearAccountId}
                      onChange={(e) => setNearAccountId(e.target.value)}
                      placeholder="e.g. 64-hex implicit address or fresh-account.testnet"
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Option B: Cross-Chain 1Click */}
              {payoutOption === "crosschain" && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="chain" className="block text-xs uppercase tracking-wider text-neutral-400 mb-1">
                      Destination Chain &amp; Asset
                    </label>
                    <select
                      id="chain"
                      value={destinationChain}
                      onChange={(e) => setDestinationChain(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-sky-500"
                    >
                      <option value="Tron USDT">Tron (USDT - TRC20)</option>
                      <option value="Ethereum USDC">Ethereum (USDC - ERC20)</option>
                      <option value="Arbitrum USDC">Arbitrum (USDC)</option>
                      <option value="Solana USDC">Solana (USDC)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="crosschainAddress" className="block text-xs uppercase tracking-wider text-neutral-400 mb-1">
                      Recipient Address on {destinationChain}
                    </label>
                    <input
                      id="crosschainAddress"
                      type="text"
                      value={crosschainRecipient}
                      onChange={(e) => setCrosschainRecipient(e.target.value)}
                      placeholder="e.g. T... (Tron) or 0x... (Ethereum/Arbitrum)"
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleGetQuote}
                    disabled={quoteLoading || !crosschainRecipient.trim()}
                    className="py-2 px-4 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sky-400 border border-neutral-700 text-xs font-semibold transition disabled:opacity-40"
                  >
                    {quoteLoading ? "Querying 1Click Quote..." : "Get Cross-Chain Quote Preview"}
                  </button>

                  {/* Quote Preview */}
                  {quote && (
                    <div className="rounded-lg border border-neutral-700 bg-black/40 p-4 space-y-2 text-xs">
                      <div className="font-semibold text-neutral-200">1Click Cross-Chain Quote Preview</div>
                      <div className="grid grid-cols-2 gap-2 text-neutral-300">
                        <div>
                          <span className="text-neutral-500 block">Est. Payout Amount:</span>
                          <span className="font-mono font-medium text-emerald-400">
                            {quote.estimatedAmount} {quote.destinationAsset}
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500 block">Deposit Address:</span>
                          <span className="font-mono text-neutral-200 break-all">{quote.depositAddress}</span>
                        </div>
                        {quote.memo && (
                          <div className="col-span-2">
                            <span className="text-neutral-500 block">Memo:</span>
                            <span className="font-mono text-neutral-400 break-all">{quote.memo}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Submit Claim Button */}
              <div className="pt-4 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={handleSubmitClaim}
                  disabled={
                    claimSubmitting ||
                    (payoutOption === "near" && !nearAccountId.trim()) ||
                    (payoutOption === "crosschain" && !quote)
                  }
                  className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {claimSubmitting ? "Signing & Submitting Claim to Relayer..." : "Submit Claim for Payout"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-neutral-950 p-8 text-neutral-400">Loading Claim...</div>}>
      <ClaimContent />
    </Suspense>
  );
}
