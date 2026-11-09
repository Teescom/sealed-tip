import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { type Tip, type TipBundle } from "@sealedtip/core";
import {
  newX25519KeyPair,
  sealBundle,
  sealTo,
  toBase64,
} from "@sealedtip/crypto";

import {
  decryptPanelTip,
  derivePublicKey,
  generateDaoProposal,
  generateProposalCliCommand,
  generateTriageCliCommand,
  generateVoteCliCommand,
  isRecused,
  parsePrivateKey,
  toHex,
  RECUSAL_ALERT_MESSAGE,
  type ApiLike,
} from "../app/panel/page";

import {
  computeScopeHash,
  generateProgrammeCommands,
  nearToYocto,
  usdcToUnits,
  RESERVE_ON_TRIAGE_GUARANTEE,
} from "../app/programmes/new/page";

const createMockBundle = async (): Promise<TipBundle> => ({
  version: 1,
  title: "Procurement Bid Rigging in Municipal Works",
  description: "Detailed insider evidence showing coordinated bidding between contractors.",
  files: [
    {
      name: "bid_records.pdf",
      mime: "application/pdf",
      data: await toBase64(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35])),
    },
  ],
  report: {
    files: [
      {
        name: "bid_records.pdf",
        type: "application/pdf",
        pages: 4,
        removed: ["Author", "CreationDate", "Producer"],
        scanMode: false,
      },
    ],
    warnings: [],
  },
  redaction: {
    original_text: "Contact Bob at Acme Corp on 555-0199",
    final_text: "Contact [REDACTED] at [REDACTED] on [REDACTED]",
    suggestions: [
      { span: "Bob", reason: "Personal identifier", replacement: "[REDACTED]" },
      { span: "Acme Corp", reason: "Entity identifier", replacement: "[REDACTED]" },
    ],
    residual_risks: [],
    unparsed: null,
    model: "intel-tdx-near-ai-v1",
    nonce: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  },
});

describe("Panel Page Decryption Pipeline (S-10.7)", () => {
  it("decrypts an exhibit bundle successfully with panel member X25519 private key", async () => {
    const memberKey = await newX25519KeyPair();
    const bundle = await createMockBundle();

    // 1. Seal bundle
    const { key, ciphertext, cid: evidenceCid, hash: evidenceHash } = await sealBundle(bundle);

    // 2. Seal symmetric key K to panel member's public key
    const sealedKeyBox = await sealTo(key, memberKey.publicKey);
    const keyBoxCid = "cid-key-box-1";

    // 3. Mock blob store
    const blobs: Record<string, Uint8Array> = {
      [evidenceCid]: ciphertext,
      [keyBoxCid]: sealedKeyBox,
    };

    const mockApi: ApiLike = {
      getBlob: async (cid: string) => blobs[cid] ?? null,
    };

    // 4. Construct on-chain Tip representation
    const tip: Tip = {
      id: 42,
      programme_id: 1,
      claim_pubkey: new Array(32).fill(9),
      nonce: 1,
      evidence_cid: evidenceCid,
      evidence_hash: Array.from(evidenceHash),
      sealed_keys: [{ member: "panel1.testnet", cid: keyBoxCid }],
      recused: [],
      cleaning_report_hash: new Array(32).fill(1),
      attestation_hash: new Array(32).fill(2),
      switch: null,
      status: "Submitted",
      submitted_at: "1700000000000000000",
      triaged_by: null,
      released_keys: [],
    };

    // 5. Decrypt using panel pipeline
    const decrypted = await decryptPanelTip({ api: mockApi }, tip, "panel1.testnet", memberKey.secretKey);

    assert.equal(decrypted.version, 1);
    assert.equal(decrypted.title, bundle.title);
    assert.equal(decrypted.description, bundle.description);
    assert.equal(decrypted.files.length, 1);
    assert.equal(decrypted.files[0]?.name, "bid_records.pdf");
    assert.equal(decrypted.report.files[0]?.removed.length, 3);
    assert.equal(decrypted.redaction?.model, "intel-tdx-near-ai-v1");
  });

  it("decrypts when member is not explicitly matched by account ID via trial unwrap", async () => {
    const memberKey = await newX25519KeyPair();
    const otherKey = await newX25519KeyPair();
    const bundle = await createMockBundle();

    const { key, ciphertext, cid: evidenceCid, hash: evidenceHash } = await sealBundle(bundle);

    const dummyBox = await sealTo(new Uint8Array(32).fill(0), otherKey.publicKey);
    const validBox = await sealTo(key, memberKey.publicKey);

    const blobs: Record<string, Uint8Array> = {
      [evidenceCid]: ciphertext,
      "dummy-box-cid": dummyBox,
      "valid-box-cid": validBox,
    };

    const mockApi: ApiLike = {
      getBlob: async (cid: string) => blobs[cid] ?? null,
    };

    const tip: Tip = {
      id: 99,
      programme_id: 1,
      claim_pubkey: new Array(32).fill(5),
      nonce: 1,
      evidence_cid: evidenceCid,
      evidence_hash: Array.from(evidenceHash),
      sealed_keys: [
        { member: "other-member.testnet", cid: "dummy-box-cid" },
        { member: "anonymous-slot.testnet", cid: "valid-box-cid" },
      ],
      recused: [],
      cleaning_report_hash: new Array(32).fill(1),
      attestation_hash: null,
      switch: null,
      status: "Submitted",
      submitted_at: "1700000000000000000",
      triaged_by: null,
      released_keys: [],
    };

    // Even if member is specified as "panel1.testnet", trial unwrap across sealed_keys succeeds
    const decrypted = await decryptPanelTip({ api: mockApi }, tip, "panel1.testnet", memberKey.secretKey);
    assert.equal(decrypted.title, bundle.title);
  });
});

describe("Recusal Safety Enforcement (Invariant 6)", () => {
  it("blocks triage and decryption for recused panel members", async () => {
    const memberKey = await newX25519KeyPair();
    let apiCallCount = 0;

    const mockApi: ApiLike = {
      getBlob: async () => {
        apiCallCount++;
        return null;
      },
    };

    const recusedTip: Tip = {
      id: 10,
      programme_id: 1,
      claim_pubkey: new Array(32).fill(1),
      nonce: 0,
      evidence_cid: "cid-evidence",
      evidence_hash: new Array(32).fill(2),
      sealed_keys: [{ member: "other.testnet", cid: "cid-other" }],
      recused: ["panel-recused.testnet", "panel-conflict.testnet"],
      cleaning_report_hash: new Array(32).fill(3),
      attestation_hash: null,
      switch: null,
      status: "Submitted",
      submitted_at: "1700000000000000000",
      triaged_by: null,
      released_keys: [],
    };

    // Check isRecused helper
    assert.equal(isRecused(recusedTip, "panel-recused.testnet"), true);
    assert.equal(isRecused(recusedTip, "panel-conflict.testnet"), true);
    assert.equal(isRecused(recusedTip, "panel-honest.testnet"), false);

    // Attempting decryption must throw with exact invariant sentence
    await assert.rejects(
      async () => {
        await decryptPanelTip({ api: mockApi }, recusedTip, "panel-recused.testnet", memberKey.secretKey);
      },
      (err: Error) => {
        assert.equal(err.message, RECUSAL_ALERT_MESSAGE);
        return true;
      },
    );

    // Verify zero API calls were made (no ciphertext downloaded when recused)
    assert.equal(apiCallCount, 0);
  });
});

describe("Sputnik DAO Proposal & Governance Generator (S-10.7)", () => {
  it("generates an Accept resolution proposal with base64 encoded args and correct amounts", () => {
    const res = generateDaoProposal({
      contractId: "sealedtip.testnet",
      tipId: 42,
      outcome: "Accept",
      rewardUSDC: 750,
    });

    assert.equal(res.proposal.kind.FunctionCall.receiver_id, "sealedtip.testnet");
    const action = res.proposal.kind.FunctionCall.actions[0];
    assert.ok(action);
    assert.equal(action.method_name, "resolve_tip");
    assert.equal(action.deposit, "0");
    assert.equal(action.gas, "100000000000000");

    // Decode base64 arguments
    const decodedArgs = JSON.parse(atob(action.args)) as {
      tip_id: number;
      accept: boolean;
      reward: string;
      outcome?: { Accept: { reward: string } };
    };

    assert.equal(decodedArgs.tip_id, 42);
    assert.equal(decodedArgs.accept, true);
    assert.equal(decodedArgs.reward, "750000000"); // 750 * 10^6
    assert.equal(decodedArgs.outcome?.Accept?.reward, "750000000");
  });

  it("generates a Reject resolution proposal with null reward", () => {
    const res = generateDaoProposal({
      contractId: "sealedtip.testnet",
      tipId: 42,
      outcome: "Reject",
    });

    const action = res.proposal.kind.FunctionCall.actions[0];
    assert.ok(action);
    const decodedArgs = JSON.parse(atob(action.args)) as {
      tip_id: number;
      accept: boolean;
      reward: null;
    };

    assert.equal(decodedArgs.tip_id, 42);
    assert.equal(decodedArgs.accept, false);
    assert.equal(decodedArgs.reward, null);
  });

  it("generates valid triage and proposal NEAR CLI commands", () => {
    const credibleCmd = generateTriageCliCommand({
      contractId: "sealedtip.testnet",
      tipId: 5,
      credible: true,
      memberAccountId: "panel1.testnet",
    });
    assert.ok(credibleCmd.includes("near call sealedtip.testnet triage"));
    assert.ok(credibleCmd.includes('"tip_id":5'));
    assert.ok(credibleCmd.includes('"credible":true'));
    assert.ok(credibleCmd.includes("--accountId panel1.testnet"));

    const dismissCmd = generateTriageCliCommand({
      contractId: "sealedtip.testnet",
      tipId: 5,
      credible: false,
      memberAccountId: "panel1.testnet",
    });
    assert.ok(dismissCmd.includes('"credible":false'));

    const proposalCli = generateProposalCliCommand({
      panelDao: "dao.testnet",
      proposalPayload: { test: "data" },
      memberAccountId: "panel1.testnet",
      depositBondNear: "0.1",
    });
    assert.ok(proposalCli.includes("near call dao.testnet add_proposal"));
    assert.ok(proposalCli.includes("--deposit 0.1"));
    assert.ok(proposalCli.includes("--accountId panel1.testnet"));

    const voteCli = generateVoteCliCommand({
      panelDao: "dao.testnet",
      proposalId: 17,
      memberAccountId: "panel1.testnet",
    });
    assert.ok(voteCli.includes("act_proposal"));
    assert.ok(voteCli.includes('"VoteApprove"'));
  });
});

describe("Programme Creation & Funder Command Generation (S-10.8)", () => {
  it("formats USDC units and NEAR yocto values correctly", () => {
    assert.equal(usdcToUnits(5000), "5000000000");
    assert.equal(usdcToUnits("250.5"), "250500000");
    assert.equal(nearToYocto(2), "2000000000000000000000000");
    assert.equal(nearToYocto(0.05), "50000000000000000000000");
  });

  it("computes 32-byte sha256 scope hash", async () => {
    const hash = await computeScopeHash("https://example.org/scope-rules");
    assert.equal(hash.length, 32);
    assert.ok(hash.some((byte) => byte > 0));

    const emptyHash = await computeScopeHash("");
    assert.equal(emptyHash.length, 32);
    assert.ok(emptyHash.every((byte) => byte === 0));
  });

  it("generates full deployment instruction suite for funders", async () => {
    const res = await generateProgrammeCommands({
      contractId: "sealedtip.testnet",
      funderAccountId: "funder.testnet",
      title: "Public Interest Whistleblower Fund",
      scopeUri: "https://example.org/rules.pdf",
      scopeDescription: "Scope description text",
      maxRewardUSDC: 5000,
      opsDepositNear: 2,
      panelDao: "whistleblower-dao.sputnik-dao.near",
      tokenContract: "usdc.testnet",
      timeScale: 1,
      initialFundUSDC: 10000,
      powBits: 12,
    });

    // 1. Create / init programme command
    assert.ok(res.createCommand.includes("create_programme"));
    assert.ok(res.createCommand.includes("--deposit 2"));
    assert.ok(res.createCommand.includes("--accountId funder.testnet"));
    assert.ok(res.initProgrammeCommand.includes("init_programme"));

    // Check createArgs
    assert.equal(res.createArgs.title, "Public Interest Whistleblower Fund");
    assert.equal(res.createArgs.max_reward, "5000000000");
    assert.equal(res.createArgs.pow_bits, 12);
    assert.equal(res.createArgs.time_scale, 1);
    assert.equal(res.createArgs.scope_hash.length, 32);

    // 2. Token ft_transfer_call funding command
    assert.ok(res.fundCommand.includes("near call usdc.testnet ft_transfer_call"));
    assert.ok(res.fundCommand.includes('"amount":"10000000000"'));
    assert.ok(res.fundCommand.includes('"msg":"{\\"fund\\":<PROGRAMME_ID>}"'));
    assert.ok(res.fundCommand.includes("--depositYocto 1"));

    // 3. Top-up command
    assert.ok(res.topUpCommand.includes("top_up_ops"));

    // 4. Reserve-on-triage security guarantee
    assert.equal(RESERVE_ON_TRIAGE_GUARANTEE.points.length, 4);
    assert.ok(RESERVE_ON_TRIAGE_GUARANTEE.points[0]?.heading.includes("Zero Capital"));
    assert.ok(RESERVE_ON_TRIAGE_GUARANTEE.points[1]?.heading.includes("Triage"));
  });
});

describe("Key Parsing and Conversion Utilities", () => {
  it("parses 64-char hex private key and 32-byte base64 private key", async () => {
    const keyPair = await newX25519KeyPair();
    const hexKey = toHex(keyPair.secretKey);
    const b64Key = await toBase64(keyPair.secretKey);

    const fromHexParsed = parsePrivateKey(hexKey);
    assert.deepEqual(Array.from(fromHexParsed), Array.from(keyPair.secretKey));

    const fromHexWith0x = parsePrivateKey(`0x${hexKey}`);
    assert.deepEqual(Array.from(fromHexWith0x), Array.from(keyPair.secretKey));

    const fromB64Parsed = parsePrivateKey(b64Key);
    assert.deepEqual(Array.from(fromB64Parsed), Array.from(keyPair.secretKey));

    assert.throws(() => parsePrivateKey("not-a-valid-key"), /Private key must be 32 bytes/);
  });

  it("derives correct X25519 public key from private key", async () => {
    const keyPair = await newX25519KeyPair();
    const derivedPub = await derivePublicKey(keyPair.secretKey);
    assert.deepEqual(Array.from(derivedPub), Array.from(keyPair.publicKey));
  });
});
