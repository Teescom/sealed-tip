// Tests for submit-flow.ts and action flows (S-10.4, S-10.5, S-10.6).
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { type Payout, type Programme } from "@sealedtip/core";
import { newX25519KeyPair, wordsToSecret } from "@sealedtip/crypto";

import { type TipApi } from "../lib/api";
import {
  checkinFlow,
  claimFlow,
  retractFlow,
  submitTipFlow,
  type FileInput,
  type SubmitProgressStep,
  type SubmitTipDeps,
} from "../lib/submit-flow";

const samplePngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, // IDAT
  0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82, // IEND
]);

const mockCanvasHost = () => {
  return {
    surface: (w: number, h: number) => ({
      width: w,
      height: h,
      target: {},
      read: async () => new Uint8Array(w * h * 4),
      write: async () => {},
      encode: async () => samplePngBytes,
    }),
    decode: async () => ({
      width: 1,
      height: 1,
      target: {},
      read: async () => new Uint8Array(4),
      write: async () => {},
      encode: async () => samplePngBytes,
    }),
    pdfOptions: () => ({}),
  };
};

const setupTestProgramme = async (): Promise<Programme> => {
  const p1 = await newX25519KeyPair();
  const p2 = await newX25519KeyPair();
  const p3 = await newX25519KeyPair();
  return {
    id: 1,
    funder: "funder.testnet",
    title: "Test Programme",
    scope_uri: "ipfs://test",
    scope_hash: new Array(32).fill(1),
    panel_dao: "dao.testnet",
    panel: [
      { account: "panel-alice.testnet", x25519_pub: Array.from(p1.publicKey) },
      { account: "panel-bob.testnet", x25519_pub: Array.from(p2.publicKey) },
      { account: "panel-carol.testnet", x25519_pub: Array.from(p3.publicKey) },
    ],
    token: "token.testnet",
    max_reward: "1000",
    balance: "5000",
    reserved: "0",
    ops_balance: "1000000000000000000000000",
    gas_drip: "50000000000000000000000",
    pow_bits: 0, // 0 bits for instantaneous test mining
    open: true,
    time_scale: 1,
    created_at: "1000000",
  };
};

describe("submitTipFlow", () => {
  it("submits a tip through the complete 9-step pipeline", async () => {
    const programme = await setupTestProgramme();
    const keeper = await newX25519KeyPair();
    const blobs: Record<string, Uint8Array> = {};
    let relayedAction: string | null = null;
    let relayedArgs: Record<string, unknown> | null = null;

    const fakeApi: TipApi = {
      putBlob: async (bytes: Uint8Array) => {
        const cid = `cid-${Object.keys(blobs).length + 1}`;
        blobs[cid] = bytes;
        return { ok: true, value: { cid, bytes: bytes.byteLength } };
      },
      getBlob: async (cid: string) => ({ ok: true, value: blobs[cid] ?? null }),
      relay: async (action, args) => {
        relayedAction = action;
        relayedArgs = args;
        return { ok: true, value: { queuedUntil: Date.now() + 5000 } };
      },
      redact: async () => ({ ok: false, status: 501, error: "not used in this test" }),
    };

    const deps: SubmitTipDeps = {
      api: fakeApi,
      canvasHost: mockCanvasHost(),
      getKeeperInfo: async () => ({
        keeper: "keeper.testnet",
        keeper_x25519_pub: Array.from(keeper.publicKey),
        keeper_last_seen: "12345",
      }),
    };

    const file: FileInput = {
      name: "evidence.png",
      blob: new Blob([samplePngBytes], { type: "image/png" }),
    };

    const progressSteps: SubmitProgressStep[] = [];

    const result = await submitTipFlow(
      {
        programme,
        title: "Test Submission",
        description: "A confidential whistleblower report",
        files: [file],
        recused: ["panel-carol.testnet"], // Carol recused; Alice and Bob remain (>= 2)
        deadMansSwitch: {
          intervalDays: 7,
          graceDays: 2,
          includesRaw: false,
        },
        onProgress: (step) => progressSteps.push(step),
      },
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(result.secretWords.length, 24);
    assert.deepEqual(wordsToSecret(result.secretWords), result.secret);
    assert.equal(relayedAction, "submit_tip");
    assert.ok(relayedArgs !== null);

    const args = relayedArgs as Record<string, unknown>;
    assert.equal(args.programme_id, 1);
    assert.equal(args.evidence_cid, result.evidenceCid);
    assert.deepEqual(args.recused, ["panel-carol.testnet"]);
    // 2 non-recused panel members received sealed keys
    assert.equal((args.sealed_keys as unknown[]).length, 2);
    // Switch is configured with keeper CID
    assert.ok(args.switch !== null);
    assert.equal((args.switch as { includes_raw: boolean }).includes_raw, false);

    // Verify progress steps ran
    assert.ok(progressSteps.some((p) => p.phase === "cleaning"));
    assert.ok(progressSteps.some((p) => p.phase === "reporting"));
    assert.ok(progressSteps.some((p) => p.phase === "sealing"));
    assert.ok(progressSteps.some((p) => p.phase === "uploading-evidence"));
    assert.ok(progressSteps.some((p) => p.phase === "sealing-keys"));
    assert.ok(progressSteps.some((p) => p.phase === "mining-pow"));
    assert.ok(progressSteps.some((p) => p.phase === "signing"));
    assert.ok(progressSteps.some((p) => p.phase === "relaying"));
  });

  it("refuses submission if fewer than 2 non-recused panel members remain", async () => {
    const programme = await setupTestProgramme();
    const deps: SubmitTipDeps = {
      api: {} as TipApi,
      canvasHost: mockCanvasHost(),
      getKeeperInfo: async () => ({ keeper: "keeper", keeper_x25519_pub: [], keeper_last_seen: "0" }),
    };

    await assert.rejects(
      () =>
        submitTipFlow(
          {
            programme,
            title: "Test",
            description: "Test",
            files: [],
            recused: ["panel-alice.testnet", "panel-bob.testnet"], // only Carol left
          },
          deps,
        ),
      /at least 2 non-recused panel members are required/,
    );
  });

  it("refuses submission when programme is closed", async () => {
    const programme = await setupTestProgramme();
    const closed = { ...programme, open: false };
    const deps: SubmitTipDeps = {
      api: {} as TipApi,
      canvasHost: mockCanvasHost(),
      getKeeperInfo: async () => ({ keeper: "keeper", keeper_x25519_pub: [], keeper_last_seen: "0" }),
    };

    await assert.rejects(
      () =>
        submitTipFlow(
          {
            programme: closed,
            title: "Test",
            description: "Test",
            files: [],
          },
          deps,
        ),
      /programme 1 is closed to new tips/,
    );
  });
});

describe("signed action flows", () => {
  const secret = new Uint8Array(32).fill(42);

  it("checkinFlow signs Checkin and relays", async () => {
    let calledAction: string | null = null;
    let calledArgs: Record<string, unknown> | null = null;
    const fakeApi: TipApi = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async (action, args) => {
        calledAction = action;
        calledArgs = args;
        return { ok: true, value: { queuedUntil: 1700000000 } };
      },
      redact: async () => ({ ok: false, status: 500, error: "" }),
    };

    const res = await checkinFlow(
      { tipId: 10, nonce: 1, secret },
      { api: fakeApi, contractId: "sealedtip.testnet" },
    );
    assert.equal(res.ok, true);
    assert.equal(calledAction, "checkin");
    const args1 = calledArgs as unknown as Record<string, unknown>;
    assert.equal(args1.tip_id, 10);
    assert.equal(args1.nonce, 1);
    assert.ok(typeof args1.signature === "string");
  });

  it("retractFlow signs Retract and relays", async () => {
    let calledAction: string | null = null;
    let calledArgs: Record<string, unknown> | null = null;
    const fakeApi: TipApi = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async (action, args) => {
        calledAction = action;
        calledArgs = args;
        return { ok: true, value: { queuedUntil: 1700000000 } };
      },
      redact: async () => ({ ok: false, status: 500, error: "" }),
    };

    const res = await retractFlow(
      { tipId: 10, nonce: 2, secret },
      { api: fakeApi, contractId: "sealedtip.testnet" },
    );
    assert.equal(res.ok, true);
    assert.equal(calledAction, "retract");
    const args2 = calledArgs as unknown as Record<string, unknown>;
    assert.equal(args2.tip_id, 10);
    assert.equal(args2.nonce, 2);
  });

  it("claimFlow signs Claim with Near payout and relays", async () => {
    let calledAction: string | null = null;
    let calledArgs: Record<string, unknown> | null = null;
    const fakeApi: TipApi = {
      putBlob: async () => ({ ok: false, status: 500, error: "" }),
      getBlob: async () => ({ ok: false, status: 500, error: "" }),
      relay: async (action, args) => {
        calledAction = action;
        calledArgs = args;
        return { ok: true, value: { queuedUntil: 1700000000 } };
      },
      redact: async () => ({ ok: false, status: 500, error: "" }),
    };

    const payout: Payout = { Near: { account: "fresh-whistleblower.testnet" } };
    const res = await claimFlow(
      { tipId: 10, nonce: 3, payout, secret },
      { api: fakeApi, contractId: "sealedtip.testnet" },
    );
    assert.equal(res.ok, true);
    assert.equal(calledAction, "claim");
    const args3 = calledArgs as unknown as Record<string, unknown>;
    assert.equal(args3.tip_id, 10);
    assert.deepEqual(args3.payout, payout);
  });
});
