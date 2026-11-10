"use client";

import { Suspense, useEffect, useState } from "react";
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

import { createTipApi } from "@/lib/api";
import { readPublicConfig, type PublicConfig } from "@/lib/config";
import { fetchCrossChainQuote, type QuoteResponse } from "@/lib/quote";
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
        rpcUrl: "https://rpc.testnet.fastnear.com",
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
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="card on-paper space-y-6 p-5 sm:p-8">
        <div>
          <h1 className="display text-[clamp(1.75rem,5vw,2.25rem)] text-ask">Claim a bounty</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Submit your signed claim anonymously. A testnet NEAR payout works in this build. The
            cross-chain route through 1Click needs the tip API to hold a 1Click key; until this deployment
            does, this page will say so rather than show a made-up rate.
          </p>
        </div>

        {/* Credentials Form */}
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
              <label htmlFor="words" className="block text-xs text-ink-muted">
                Recovery words
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
            {loading ? "Checking your words…" : "Check whether this tip can be claimed"}
          </button>
        </form>

        {/* Global Error Banner */}
        {error && (
          <p className="mt-6 border-l-4 border-l-bad bg-paper p-4 text-sm text-bad">{error}</p>
        )}

        {/* Credential Warning Banner */}
        {credentialWarning && (
          <div className="mt-6 border-l-4 border-l-warn bg-paper p-4">
            <h3 className="text-sm font-semibold text-ink">These words do not match tip #{tip?.id}</h3>
            <p className="mt-1 text-xs text-ink-muted">
              The public key derived from your words is not the claim key recorded for this tip. Check you pasted all
              24, in order.
            </p>
          </div>
        )}

        {/* Ineligibility Reason Banner */}
        {tip && claimStatus && !claimStatus.claimable && (
          <div className="mt-6 card-inset p-6">
            <h2 className="display text-[clamp(1.25rem,4vw,1.6rem)] text-ink">This tip cannot be claimed yet</h2>
            <p className="mt-2 text-sm text-ink-muted">{claimStatus.reason}</p>
            <dl className="mt-4 divide-y divide-rule border-t border-rule text-xs">
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-ink-muted">Tip</dt>
                <dd className="datum text-ink">#{tip.id}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-ink-muted">Programme</dt>
                <dd className="datum text-ink">#{tip.programme_id}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Only a tip the panel has approved, with a reward greater than zero, can be claimed.
            </p>
          </div>
        )}

        {/* Claim Submission Success */}
        {claimSuccess && (
          <div className="mt-8 card-inset space-y-4 p-6">
            <h2 className="display text-[clamp(1.25rem,4vw,1.6rem)] text-ink">Claim submitted</h2>

            <p className="text-sm text-ink-muted">
              The relayer holds it until{" "}
              <span className="datum text-ink">{new Date(claimSuccess.queuedUntil).toLocaleString()}</span>, so the
              payout is not timed to your submission.
            </p>

            <p className="border-l-4 border-l-warn bg-paper p-3 text-xs text-ink-muted">
              On testnet the contract sends the funds and enough gas to use them once the relay runs.
            </p>

            <div className="text-xs pt-2 border-t border-rule">
              <span className="text-ink-muted">Payout destination: </span>
              {"Near" in claimSuccess.payout
                ? claimSuccess.payout.Near.account
                : `${claimSuccess.payout.Intents.deposit_address}${
                    claimSuccess.payout.Intents.memo ? ` · memo ${claimSuccess.payout.Intents.memo}` : ""
                  }`}
            </div>
          </div>
        )}

        {/* Eligible Claim Configuration & Actions */}
        {tip && claimStatus?.claimable && !claimSuccess && (
          <div className="mt-8 space-y-6">
            {/* Reward Summary */}
            <div className="card-inset p-5 sm:p-6">
              <p className="text-xs text-ink-muted">Approved reward</p>
              <p className="display mt-1 text-[clamp(2rem,7vw,3rem)] leading-none text-ok">
                {claimStatus.reward}
              </p>
              <dl className="mt-4 divide-y divide-rule border-t border-rule text-xs">
                <div className="flex items-baseline justify-between gap-4 py-2">
                  <dt className="text-ink-muted">Tip</dt>
                  <dd className="datum text-ink">#{tip.id}</dd>
                </div>
              </dl>
            </div>

            {/* Destination Selection */}
            <div className="card-inset p-6 space-y-6">
              <div>
                <h2 className="text-base font-semibold text-ink mb-1">Where should the reward go?</h2>
                <p className="text-xs text-ink-muted">
                  Use an address that has never touched an account tied to you. A wallet you already sign in to can
                  identify this payout.
                </p>
              </div>

              {/* Tabs */}
              <div className="flex flex-col border-b border-rule sm:flex-row" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={payoutOption === "near"}
                  onClick={() => setPayoutOption("near")}
                  className={`min-h-[44px] pb-3 px-4 text-xs font-semibold border-b-2 transition flex items-center justify-center cursor-pointer ${
                    payoutOption === "near"
                      ? "border-ask text-ink"
                      : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  A fresh NEAR account (testnet)
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={payoutOption === "crosschain"}
                  onClick={() => setPayoutOption("crosschain")}
                  className={`min-h-[44px] pb-3 px-4 text-xs font-semibold border-b-2 transition flex items-center justify-center cursor-pointer ${
                    payoutOption === "crosschain"
                      ? "border-ask text-ink"
                      : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  Cross-chain, over 1Click (mainnet)
                </button>
              </div>

              {/* Option A: NEAR Payout */}
              {payoutOption === "near" && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted">Generate one in this browser</span>
                    <button
                      type="button"
                      onClick={handleGenerateFreshAccount}
                      aria-label="Generate a new anonymous Ed25519 keypair and implicit NEAR account"
                      className="btn-primary px-3.5 text-xs shrink-0"
                    >
                      Generate a fresh account
                    </button>
                  </div>

                  {/* Generated Account Details */}
                  {generatedAccount && (
                    <div className="card-inset border-l-4 border-l-warn p-4 space-y-3">
                      <h3 className="text-sm font-semibold text-ink">Save this private key now</h3>
                      <p className="text-xs text-warn">
                        This is a fresh anonymous NEAR account generated entirely in your browser. Nobody else has this key.
                        You will need it to access your reward funds. Sealed Tip cannot recover it for you.
                      </p>

                      <div className="space-y-2 text-xs font-mono">
                        <div>
                          <span className="block text-xs text-ink-muted">Account id (64-char hex)</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="datum flex-1 rounded-inset border border-edge bg-paper p-2 text-ink select-all">
                              {generatedAccount.accountId}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(generatedAccount.accountId);
                                setCopiedAccount(true);
                                setTimeout(() => setCopiedAccount(false), 2000);
                              }}
                              aria-label="Copy generated account ID"
                              className="btn-secondary min-w-[72px] px-3 text-xs shrink-0"
                            >
                              {copiedAccount ? "Copied" : "Copy account id"}
                            </button>
                          </div>
                        </div>

                        <div>
                          <span className="block text-xs text-ink-muted">Private key</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="datum flex-1 rounded-inset border border-edge bg-paper p-2 text-warn select-all">
                              {generatedAccount.secretKey}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(generatedAccount.secretKey);
                                setCopiedKey(true);
                                setTimeout(() => setCopiedKey(false), 2000);
                              }}
                              aria-label="Copy generated private key"
                              className="btn-secondary min-w-[72px] px-3 text-xs shrink-0"
                            >
                              {copiedKey ? "Copied" : "Copy private key"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <label htmlFor="nearAccount" className="block text-xs text-ink-muted mb-1">
                      Destination NEAR Account ID
                    </label>
                    <input
                      id="nearAccount"
                      type="text"
                      required
                      value={nearAccountId}
                      onChange={(e) => setNearAccountId(e.target.value)}
                      placeholder="e.g. 64-hex implicit address or fresh-account.testnet"
                      className="w-full bg-paper border border-edge rounded-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Option B: Cross-Chain 1Click */}
              {payoutOption === "crosschain" && (
                <div className="space-y-4">
                  <p className="text-xs text-ink-muted">
                    The quote endpoint answers only when the tip API is configured with a 1Click key.
                    Without one it says so, and no cross-chain quote is fetched here. A testnet NEAR payout
                    is the route that works.
                  </p>
                  <div>
                    <label htmlFor="chain" className="block text-xs text-ink-muted mb-1">
                      Destination Chain &amp; Asset
                    </label>
                    <select
                      id="chain"
                      value={destinationChain}
                      onChange={(e) => setDestinationChain(e.target.value)}
                      className="w-full bg-paper border border-edge rounded-field px-3 py-2 text-sm text-ink"
                    >
                      <option value="Tron USDT">Tron (USDT - TRC20)</option>
                      <option value="Ethereum USDC">Ethereum (USDC - ERC20)</option>
                      <option value="Arbitrum USDC">Arbitrum (USDC)</option>
                      <option value="Solana USDC">Solana (USDC)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="crosschainAddress" className="block text-xs text-ink-muted mb-1">
                      Recipient Address on {destinationChain}
                    </label>
                    <input
                      id="crosschainAddress"
                      type="text"
                      value={crosschainRecipient}
                      onChange={(e) => setCrosschainRecipient(e.target.value)}
                      placeholder="e.g. T... (Tron) or 0x... (Ethereum/Arbitrum)"
                      className="w-full bg-paper border border-edge rounded-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleGetQuote}
                    disabled={quoteLoading || !crosschainRecipient.trim()}
                    className="btn-secondary px-4 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {quoteLoading ? "Querying the quote…" : "Preview the cross-chain quote"}
                  </button>

                  {/* Quote Preview */}
                  {quote && (
                    <div className="card-inset p-4">
                      <h3 className="text-sm font-semibold text-ink">Quote from 1Click</h3>
                      <dl className="mt-2 divide-y divide-rule">
                        <div className="flex items-baseline justify-between gap-4 py-2">
                          <dt className="shrink-0 text-xs text-ink-muted">Estimated payout</dt>
                          <dd className="datum text-ok">
                            {quote.estimatedAmount} {quote.destinationAsset}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 py-2">
                          <dt className="shrink-0 text-xs text-ink-muted">Deposit address</dt>
                          <dd className="datum text-right break-all text-ink">{quote.depositAddress}</dd>
                        </div>
                        {quote.memo && (
                          <div className="flex items-baseline justify-between gap-4 py-2">
                            <dt className="shrink-0 text-xs text-ink-muted">Memo</dt>
                            <dd className="datum text-right break-all text-ink-muted">{quote.memo}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                </div>
              )}

              {/* Submit Claim Button */}
              <div className="pt-4 border-t border-rule">
                <button
                  type="button"
                  onClick={handleSubmitClaim}
                  disabled={
                    claimSubmitting ||
                    (payoutOption === "near" && !nearAccountId.trim()) ||
                    (payoutOption === "crosschain" && !quote)
                  }
                  aria-label="Submit this claim for payout"
                  className="btn-primary w-full py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {claimSubmitting ? "Signing your claim…" : "Submit for payout"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-3xl px-4 py-10 text-sm text-on-ground-muted sm:px-6">Loading claim…</p>}>
      <ClaimContent />
    </Suspense>
  );
}
