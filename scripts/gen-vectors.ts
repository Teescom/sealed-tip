// Writes fixtures/vectors.json — the shared TS↔Rust parity vectors (S-6.4, consumed by tests/vectors.rs in S-5.8).
// Deterministic: every secret is sha256("sealedtip/vectors/<label>"), so re-running reproduces the file byte-for-byte.
// The account ids, passphrases and evidence hashes are fictional fixtures, not live credentials.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  actionMessage,
  deriveKeys,
  secretToWords,
  sign,
  submitMessage,
  wordsToSecret,
  type Action,
  type SignedAction,
  type TipsterKeys,
} from "@sealedtip/crypto";

type Bytes = number[];

/** `action` uses serde's external enum tagging so tests/vectors.rs can deserialize it directly. */
type FixtureAction =
  | "checkin"
  | "retract"
  | { claim_near: { account: string } }
  | { claim_intents: { deposit_address: string; memo: string | null } };

interface KeyVector {
  name: string;
  secret: Bytes;
  passphrase: string | null;
  words: string[];
  ed25519_secret: Bytes;
  ed25519_public_key: Bytes;
  x25519_secret: Bytes;
  x25519_public_key: Bytes;
}

interface ActionVector {
  name: string;
  key: string;
  contract: string;
  tip_id: number;
  nonce: number;
  action: FixtureAction;
  message: Bytes;
  public_key: Bytes;
  secret_key: Bytes;
  signature: Bytes;
}

interface SubmitVector {
  name: string;
  key: string;
  programme_id: number;
  evidence_hash: Bytes;
  claim_pubkey: Bytes;
  message: Bytes;
  public_key: Bytes;
  secret_key: Bytes;
  signature: Bytes;
}

const CONTRACT = "sealedtip.testnet";

// Dev-only seed hashing; the vectors themselves are produced by @sealedtip/crypto.
const hash = (label: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(`sealedtip/vectors/${label}`).digest());
const list = (value: Uint8Array): Bytes => Array.from(value);
const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
/** 64 lowercase hex chars: a valid NEAR implicit account, which is what a tipster claims to. */
const implicitAccount = (label: string): string => hex(hash(label));

// `empty-passphrase` deliberately reuses `no-passphrase`'s secret: the fixture then states the
// invariant that an absent and an empty passphrase must derive the same key.
const keyDefs: ReadonlyArray<{ name: string; secretLabel: string; passphrase: string | null }> = [
  { name: "no-passphrase", secretLabel: "keys/unguarded", passphrase: null },
  { name: "empty-passphrase", secretLabel: "keys/unguarded", passphrase: "" },
  { name: "with-passphrase", secretLabel: "keys/guarded", passphrase: "baobab-mango-2026" },
];

const actionDefs: ReadonlyArray<{ name: string; key: string; tip_id: number; nonce: number; action: Action }> = [
  { name: "checkin", key: "no-passphrase", tip_id: 7, nonce: 1, action: "Checkin" },
  { name: "retract", key: "no-passphrase", tip_id: 7, nonce: 2, action: "Retract" },
  {
    name: "claim-near",
    key: "with-passphrase",
    tip_id: 8,
    nonce: 1,
    action: { Claim: { payout: { Near: { account: implicitAccount("payout/near") } } } },
  },
  {
    // nonce > 2^32 catches an encoder that wrote u32 where the contract reads u64.
    name: "claim-intents-with-memo",
    key: "empty-passphrase",
    tip_id: 9,
    nonce: 4294967297,
    action: {
      Claim: { payout: { Intents: { deposit_address: implicitAccount("payout/intents"), memo: "tip-9" } } },
    },
  },
  {
    name: "claim-intents-null-memo",
    key: "no-passphrase",
    tip_id: 10,
    nonce: 4,
    action: {
      Claim: { payout: { Intents: { deposit_address: implicitAccount("payout/intents"), memo: null } } },
    },
  },
];

const fixtureAction = (action: Action): FixtureAction => {
  if (action === "Checkin") return "checkin";
  if (action === "Retract") return "retract";
  const { payout } = action.Claim;
  if ("Near" in payout) return { claim_near: { account: payout.Near.account } };
  return { claim_intents: { deposit_address: payout.Intents.deposit_address, memo: payout.Intents.memo } };
};

const main = async (): Promise<void> => {
  const keys: KeyVector[] = [];
  const derivedByName = new Map<string, TipsterKeys>();

  for (const def of keyDefs) {
    const secret = hash(def.secretLabel);
    const words = secretToWords(secret);
    if (hex(wordsToSecret(words)) !== hex(secret)) throw new Error(`BIP39 round trip failed: ${def.name}`);
    const keysFor = await deriveKeys(secret, def.passphrase ?? undefined);
    derivedByName.set(def.name, keysFor);
    keys.push({
      name: def.name,
      secret: list(secret),
      passphrase: def.passphrase,
      words,
      ed25519_secret: list(keysFor.ed25519.secretKey),
      ed25519_public_key: list(keysFor.ed25519.publicKey),
      x25519_secret: list(keysFor.x25519.secretKey),
      x25519_public_key: list(keysFor.x25519.publicKey),
    });
  }

  const vectors: ActionVector[] = actionDefs.map((def) => {
    const keysFor = derivedByName.get(def.key);
    if (keysFor === undefined) throw new Error(`missing derived keys: ${def.key}`);
    const signed: SignedAction = {
      contract: CONTRACT,
      tipId: def.tip_id,
      nonce: def.nonce,
      action: def.action,
    };
    const message = actionMessage(signed);
    return {
      name: def.name,
      key: def.key,
      contract: CONTRACT,
      tip_id: def.tip_id,
      nonce: def.nonce,
      action: fixtureAction(def.action),
      message: list(message),
      public_key: list(keysFor.ed25519.publicKey),
      secret_key: list(keysFor.ed25519.secretKey),
      signature: list(sign(message, keysFor.ed25519.secretKey)),
    };
  });

  const submitDefs = [
    { name: "submit-basic", key: "no-passphrase", programme_id: 3, evidence: "evidence/invoice-page-1" },
    { name: "submit-scan-mode", key: "with-passphrase", programme_id: 18, evidence: "evidence/printout-scan" },
  ];
  const submit: SubmitVector[] = submitDefs.map((def) => {
    const keysFor = derivedByName.get(def.key);
    if (keysFor === undefined) throw new Error(`missing derived keys: ${def.key}`);
    const evidenceHash = hash(def.evidence);
    const claimPubkey = keysFor.ed25519.publicKey;
    const message = submitMessage(def.programme_id, evidenceHash, claimPubkey);
    return {
      name: def.name,
      key: def.key,
      programme_id: def.programme_id,
      evidence_hash: list(evidenceHash),
      claim_pubkey: list(claimPubkey),
      message: list(message),
      public_key: list(claimPubkey),
      secret_key: list(keysFor.ed25519.secretKey),
      signature: list(sign(message, keysFor.ed25519.secretKey)),
    };
  });

  const fixture = {
    _note:
      "Shared TS<->Rust vectors (S-6.4). Generated by `pnpm gen-vectors`; do not edit by hand. " +
      "Binary values are byte arrays. `action` uses serde external enum tagging (tests/vectors.rs reads it).",
    hkdf_labels: { sha: "hkdf-sha256", ed25519: "sealedtip/ed25519/v1", x25519: "sealedtip/x25519/v1" },
    keys,
    vectors,
    submit,
  };

  const target = fileURLToPath(new URL("../fixtures/vectors.json", import.meta.url));
  writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${vectors.length} action + ${submit.length} submit + ${keys.length} key vectors`);
};

await main();
