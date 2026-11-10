import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  type Payout,
  type Tip,
  type TipPublic,
  type TipStatus,
  type ViewClient,
} from "@sealedtip/core";
import {
  deriveKeys,
  newSecret,
  secretToWords,
  wordsToSecret,
  type TipsterKeys,
} from "@sealedtip/crypto";

import { type TipApi } from "../lib/api";
import { fetchCrossChainQuote, QuoteUnavailableError } from "../lib/quote";
import { checkinFlow, claimFlow, retractFlow } from "../lib/submit-flow";

// --- Logic mirroring apps/web/app/status/page.tsx ---

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

// --- Logic mirroring apps/web/app/claim/page.tsx ---

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


// ==========================================
// Test Suites
// ==========================================

describe("Status page logic (S-10.5)", () => {
  const secret = newSecret();
  const words = secretToWords(secret);

  it("credentialsFromWords derives secret and claim pubkey from 24 words", async () => {
    const creds = await credentialsFromWords(words);
    assert.equal(creds.secret.length, 32);
    assert.deepEqual(Array.from(creds.secret), Array.from(secret));
    assert.equal(creds.claimPubkey.length, 32);

    const stringWords = words.join(" ");
    const credsFromString = await credentialsFromWords(stringWords);
    assert.deepEqual(Array.from(credsFromString.claimPubkey), Array.from(creds.claimPubkey));
  });

  it("credentialsFromWords respects optional passphrase", async () => {
    const credsNoPass = await credentialsFromWords(words);
    const credsEmptyPass = await credentialsFromWords(words, "");
    const credsWithPass = await credentialsFromWords(words, "my-secure-passphrase");

    assert.deepEqual(Array.from(credsNoPass.claimPubkey), Array.from(credsEmptyPass.claimPubkey));
    assert.notDeepEqual(Array.from(credsNoPass.claimPubkey), Array.from(credsWithPass.claimPubkey));
  });

  it("credentialsFromWords rejects invalid word counts or corrupted words", async () => {
    await assert.rejects(
      async () => credentialsFromWords(words.slice(0, 12)),
      /Expected 24 recovery words, got 12/,
    );

    const corruptWords = [...words];
    corruptWords[23] = "abandon";
    await assert.rejects(
      async () => credentialsFromWords(corruptWords),
      /checksum|invalid/i,
    );
  });

  it("matchPubkeys validates matching public keys and rejects mismatches", async () => {
    const creds = await credentialsFromWords(words);
    const pubkeyArray = Array.from(creds.claimPubkey);

    assert.equal(matchPubkeys(pubkeyArray, creds.claimPubkey), true);
    assert.equal(matchPubkeys(creds.claimPubkey, creds.claimPubkey), true);

    const wrongKey = new Array(32).fill(0);
    assert.equal(matchPubkeys(wrongKey, creds.claimPubkey), false);
    assert.equal(matchPubkeys(null, creds.claimPubkey), true);
  });

  it("canRetractTip allows retraction only before a DAO decision", () => {
    assert.equal(canRetractTip("Submitted"), true);
    assert.equal(canRetractTip("UnderReview"), true);
    assert.equal(canRetractTip("Triaged"), true);
    assert.equal(canRetractTip("Unfunded"), true);

    assert.equal(canRetractTip("Accepted"), false);
    assert.equal(canRetractTip({ Accepted: { reward: "1000" } }), false);
    assert.equal(canRetractTip("Rejected"), false);
    assert.equal(canRetractTip("Dismissed"), false);
    assert.equal(canRetractTip("Paid"), false);
    assert.equal(canRetractTip("Settled"), false);
    assert.equal(canRetractTip("Retracted"), false);
  });

  it("formatTipStatus produces human-friendly status labels and variants", () => {
    assert.deepEqual(formatTipStatus("Submitted"), { label: "Submitted", variant: "blue" });
    assert.deepEqual(formatTipStatus("UnderReview"), { label: "Triaged (Under Review)", variant: "amber" });
    assert.deepEqual(formatTipStatus({ Accepted: { reward: "500000000" } }), {
      label: "Accepted",
      variant: "emerald",
      reward: "500000000",
    });
    assert.deepEqual(formatTipStatus("Rejected"), { label: "Rejected", variant: "red" });
    assert.deepEqual(formatTipStatus("Paid"), { label: "Settled", variant: "purple" });
    assert.deepEqual(formatTipStatus("Retracted"), { label: "Retracted", variant: "neutral" });
  });

  it("formatDeadline formats nanoseconds timestamp safely", () => {
    assert.equal(formatDeadline(null), "None");
    assert.equal(formatDeadline(undefined), "None");
    const formatted = formatDeadline("1700000000000000000");
    assert.ok(typeof formatted === "string" && formatted.length > 5);
  });

  it("fetchTipDetails fetches tip state from view client", async () => {
    const creds = await credentialsFromWords(words);
    const mockPublic: TipPublic & { nonce: number; claim_pubkey: number[] } = {
      id: 5,
      programme_id: 1,
      status: "Submitted",
      submitted_at: "1794000000000000000",
      switch_deadline: "1794100000000000000",
      switch_triggered: false,
      nonce: 0,
      claim_pubkey: Array.from(creds.claimPubkey),
    };

    const mockViews = {
      getTipPublic: async (id: number) => (id === 5 ? mockPublic : null),
      getTipForPanel: async () => null,
      getProgramme: async () => null,
      listProgrammes: async () => [],
      getProgrammeStats: async () => ({} as never),
      getKeeperInfo: async () => ({} as never),
    };

    const result = await fetchTipDetails(mockViews, 5);
    assert.ok(result);
    assert.equal(result.id, 5);
    assert.equal(result.programme_id, 1);
    assert.equal(result.status, "Submitted");
    assert.equal(result.nonce, 0);
    assert.equal(result.switch_triggered, false);
    assert.deepEqual(result.claim_pubkey, Array.from(creds.claimPubkey));

    const notFound = await fetchTipDetails(mockViews, 999);
    assert.equal(notFound, null);
  });

  it("checkinFlow executes and updates relayer queue timestamp", async () => {
    const creds = await credentialsFromWords(words);
    let capturedAction: string | null = null;
    let capturedArgs: Record<string, unknown> | null = null;

    const fakeApi: TipApi = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async (action, args) => {
        capturedAction = action;
        capturedArgs = args;
        return { ok: true, value: { queuedUntil: 1731150000000 } };
      },
      redact: async () => ({ ok: false, status: 500, error: "" }),
    };

    const res = await checkinFlow(
      { tipId: 5, nonce: 0, secret: creds.secret },
      { api: fakeApi, contractId: "sealedtip.testnet" },
    );

    assert.equal(res.ok, true);
    assert.equal(res.queuedUntil, 1731150000000);
    assert.equal(capturedAction, "checkin");
    assert.equal((capturedArgs as unknown as Record<string, unknown>).tip_id, 5);
    assert.equal((capturedArgs as unknown as Record<string, unknown>).nonce, 0);
    assert.ok(typeof (capturedArgs as unknown as Record<string, unknown>).signature === "string");
  });

  it("retractFlow executes when user confirms retraction", async () => {
    const creds = await credentialsFromWords(words);
    let capturedAction: string | null = null;
    let capturedArgs: Record<string, unknown> | null = null;

    const fakeApi: TipApi = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async (action, args) => {
        capturedAction = action;
        capturedArgs = args;
        return { ok: true, value: { queuedUntil: 1731150000000 } };
      },
      redact: async () => ({ ok: false, status: 500, error: "" }),
    };

    const res = await retractFlow(
      { tipId: 5, nonce: 1, secret: creds.secret },
      { api: fakeApi, contractId: "sealedtip.testnet" },
    );

    assert.equal(res.ok, true);
    assert.equal(capturedAction, "retract");
    assert.equal((capturedArgs as unknown as Record<string, unknown>).tip_id, 5);
    assert.equal((capturedArgs as unknown as Record<string, unknown>).nonce, 1);
  });
});

describe("Claim page logic (S-10.6)", () => {
  const secret = newSecret();
  const words = secretToWords(secret);

  it("isTipClaimable verifies Accepted status with positive reward", () => {
    const eligible = isTipClaimable({ Accepted: { reward: "500000000" } });
    assert.equal(eligible.claimable, true);
    assert.equal(eligible.reward, "500000000");

    const zeroReward = isTipClaimable({ Accepted: { reward: "0" } });
    assert.equal(zeroReward.claimable, false);
    assert.match(zeroReward.reason ?? "", /reward amount is 0/);

    const submitted = isTipClaimable("Submitted");
    assert.equal(submitted.claimable, false);
    assert.match(submitted.reason ?? "", /Submitted/);

    const underReview = isTipClaimable("UnderReview");
    assert.equal(underReview.claimable, false);
    assert.match(underReview.reason ?? "", /Under Review/);

    const rejected = isTipClaimable("Rejected");
    assert.equal(rejected.claimable, false);
    assert.match(rejected.reason ?? "", /rejected or dismissed/);

    const retracted = isTipClaimable("Retracted");
    assert.equal(retracted.claimable, false);
    assert.match(retracted.reason ?? "", /retracted/);

    const paid = isTipClaimable("Paid");
    assert.equal(paid.claimable, false);
    assert.match(paid.reason ?? "", /already been claimed/);
  });

  it("generateFreshNearAccount generates 64-hex implicit account ID and ed25519 key", async () => {
    const acc1 = await generateFreshNearAccount();
    assert.equal(acc1.accountId.length, 64);
    assert.match(acc1.accountId, /^[0-9a-f]{64}$/);
    assert.ok(acc1.secretKey.startsWith("ed25519:"));
    assert.equal(acc1.publicKey.length, 32);

    const acc2 = await generateFreshNearAccount();
    assert.notEqual(acc1.accountId, acc2.accountId);
    assert.notEqual(acc1.secretKey, acc2.secretKey);
  });

  it("claimFlow relays signed Payout::Near claim", async () => {
    const creds = await credentialsFromWords(words);
    let capturedAction: string | null = null;
    let capturedArgs: Record<string, unknown> | null = null;

    const fakeApi: TipApi = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async (action, args) => {
        capturedAction = action;
        capturedArgs = args;
        return { ok: true, value: { queuedUntil: 1731160000000 } };
      },
      redact: async () => ({ ok: false, status: 500, error: "" }),
    };

    const payout: Payout = { Near: { account: "fresh-implicit-account.testnet" } };
    const res = await claimFlow(
      { tipId: 7, nonce: 2, payout, secret: creds.secret },
      { api: fakeApi, contractId: "sealedtip.testnet" },
    );

    assert.equal(res.ok, true);
    assert.equal(capturedAction, "claim");
    const args = capturedArgs as unknown as Record<string, unknown>;
    assert.equal(args.tip_id, 7);
    assert.equal(args.nonce, 2);
    assert.deepEqual(args.payout, payout);
    assert.ok(typeof args.signature === "string");
  });

  it("claimFlow relays signed Payout::Intents cross-chain claim", async () => {
    const creds = await credentialsFromWords(words);
    let capturedAction: string | null = null;
    let capturedArgs: Record<string, unknown> | null = null;

    const fakeApi: TipApi = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async (action, args) => {
        capturedAction = action;
        capturedArgs = args;
        return { ok: true, value: { queuedUntil: 1731160000000 } };
      },
      redact: async () => ({ ok: false, status: 500, error: "" }),
    };

    const payout: Payout = {
      Intents: {
        deposit_address: "1click-intents.near",
        memo: "intents:v1:tron-usdt:TXYZ123456789",
      },
    };

    const res = await claimFlow(
      { tipId: 7, nonce: 3, payout, secret: creds.secret },
      { api: fakeApi, contractId: "sealedtip.testnet" },
    );

    assert.equal(res.ok, true);
    assert.equal(capturedAction, "claim");
    const args = capturedArgs as unknown as Record<string, unknown>;
    assert.equal(args.tip_id, 7);
    assert.equal(args.nonce, 3);
    assert.deepEqual(args.payout, payout);
  });

  it("fetchCrossChainQuote still uses an injected getQuote when the API object provides one", async () => {
    const fakeApiWithQuote = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async () => ({ ok: true, value: { queuedUntil: 0 } }),
      redact: async () => ({ ok: false, status: 500, error: "" }),
      getQuote: async (req: { amount: string; destinationAsset: string }) => ({
        depositAddress: "quote-deposit.near",
        memo: "memo-123",
        estimatedAmount: req.amount,
        destinationAsset: req.destinationAsset,
      }),
    } as unknown as TipApi;

    const q1 = await fetchCrossChainQuote(fakeApiWithQuote, "http://localhost:8787", {
      originAsset: "USDC.near",
      destinationAsset: "Tron USDT",
      amount: "500",
      recipient: "T123",
    });
    assert.equal(q1.depositAddress, "quote-deposit.near");
    assert.equal(q1.memo, "memo-123");
  });

  it("a quote endpoint that is off fails loudly instead of inventing a deposit address", async () => {
    const plainApi: TipApi = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async () => ({ ok: true, value: { queuedUntil: 0 } }),
      redact: async () => ({ ok: false, status: 500, error: "" }),
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "the 1Click quote proxy is not configured on this service" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      await assert.rejects(
        fetchCrossChainQuote(plainApi, "http://localhost:8787", {
          originAsset: "USDC.near",
          destinationAsset: "Ethereum USDC",
          amount: "1000",
          recipient: "0x123",
        }),
        (err: unknown) =>
          err instanceof QuoteUnavailableError && /503/.test(err.message) && /not configured/.test(err.message),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("an unreachable quote service fails instead of returning the input amount", async () => {
    const plainApi: TipApi = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async () => ({ ok: true, value: { queuedUntil: 0 } }),
      redact: async () => ({ ok: false, status: 500, error: "" }),
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    try {
      await assert.rejects(
        fetchCrossChainQuote(plainApi, "http://localhost:8787", {
          originAsset: "USDC.near",
          destinationAsset: "Ethereum USDC",
          amount: "1000",
          recipient: "0x123",
        }),
        (err: unknown) => err instanceof QuoteUnavailableError && /ECONNREFUSED/.test(err.message),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
