// The fakes the keeper tests run against: a chain that answers the three views, a ciphertext store, a
// recorder for the two methods this service may call, and real X25519 identities.
//
// Real keys on purpose — `sealTo`/`openSealed` are what S-9.3 is *for*, and a fake seal would test the
// bookkeeping while leaving the privacy claim (the recused member cannot open what was never sealed to
// them) untested. Nothing here touches a port, a node or a timer.
import { type Programme, type SealedKey, type Tip, type TipPublic } from "@sealedtip/core";
import { type KeyPair, cidOf, newX25519KeyPair, sealTo } from "@sealedtip/crypto";

import type { BlobIO } from "../src/blobs.js";
import type { Running } from "../src/heartbeat.js";
import type { KeeperCall, KeeperMethod } from "../src/near.js";
import type { ReleaseDeps } from "../src/release.js";

export const bytes32 = (fill: number): number[] => Array.from({ length: 32 }, () => fill);

export interface Member {
  readonly account: string;
  readonly keyPair: KeyPair;
}

export const newMembers = async (count: number): Promise<Member[]> => {
  const members: Member[] = [];
  for (let index = 1; index <= count; index += 1) {
    members.push({ account: `member-${index}.testnet`, keyPair: await newX25519KeyPair() });
  }
  return members;
};

/** The tip as `get_tip_for_panel` returns it, with the switch the tests need to vary. */
export const makeTip = (
  id: number,
  options: {
    programmeId?: number;
    recused?: string[];
    triggered?: boolean;
    keeperCid?: string;
    releasedKeys?: SealedKey[];
    hasSwitch?: boolean;
  } = {},
): Tip => ({
  id,
  programme_id: options.programmeId ?? 0,
  claim_pubkey: bytes32(1),
  nonce: 0,
  evidence_cid: "evidence-cid",
  evidence_hash: bytes32(2),
  sealed_keys: [],
  recused: options.recused ?? [],
  cleaning_report_hash: bytes32(3),
  attestation_hash: null,
  switch: options.hasSwitch === false
    ? null
    : {
        interval: "86400000000000",
        grace: "14400000000000",
        next_deadline: "1710000000000000000",
        bundle_key_for_keeper: options.keeperCid ?? cidOf(new Uint8Array([1])),
        includes_raw: false,
        triggered: options.triggered ?? false,
      },
  status: "Submitted",
  submitted_at: "1700000000000000000",
  triaged_by: null,
  released_keys: options.releasedKeys ?? [],
});

export const makePublic = (tip: Tip): TipPublic => ({
  id: tip.id,
  programme_id: tip.programme_id,
  status: tip.status,
  submitted_at: tip.submitted_at,
  switch_deadline: tip.switch?.next_deadline ?? null,
  switch_triggered: tip.switch?.triggered ?? false,
});

export const makeProgramme = (id: number, members: readonly Member[]): Programme => ({
  id,
  funder: "funder.testnet",
  title: "fictional programme",
  scope_uri: "https://scope.example",
  scope_hash: bytes32(4),
  panel_dao: "dao.testnet",
  panel: members.map((member) => ({ account: member.account, x25519_pub: Array.from(member.keyPair.publicKey) })),
  token: "tusdc.testnet",
  max_reward: "500000000",
  balance: "1000000000",
  reserved: "0",
  ops_balance: "50000000000000000000000",
  gas_drip: "50000000000000000000",
  pow_bits: 20,
  open: true,
  time_scale: 1,
  created_at: "1690000000000000000",
});

export interface Chain {
  readonly tips: Map<number, Tip>;
  readonly calls: { method: KeeperMethod; args: Record<string, unknown> }[];
  /** The view surface only, so a test that reaches for anything else is a test that found a gap in S-6.2. */
  readonly views: Pick<ReleaseDeps["views"], "getTipForPanel" | "getProgramme"> & {
    getTipPublic(tipId: number): Promise<TipPublic | null>;
  };
  readonly blobs: BlobIO & { readonly store: Map<string, Uint8Array> };
  readonly call: KeeperCall;
}

/**
 * `add` puts a tip on the chain the way `submit_tip` does — id 0, 1, 2 … and nothing removed — because
 * the watch's enumeration rule is built on exactly that, and a fake that allowed a gap would let a test
 * pass against a chain that cannot exist.
 */
export const fakeChain = (members: readonly Member[], programmes: readonly Programme[] = [makeProgramme(0, members)]): Chain => {
  const tips = new Map<number, Tip>();
  const calls: Chain["calls"] = [];
  const store = new Map<string, Uint8Array>();

  const byProgramme = new Map(programmes.map((programme) => [programme.id, programme]));

  const blobs: Chain["blobs"] = Object.assign(
    {
      async get(cid: string) {
        return store.get(cid) ?? null;
      },
      async put(bytes: Uint8Array) {
        const cid = cidOf(bytes);
        store.set(cid, bytes);
        return cid;
      },
    },
    { store },
  );

  return {
    tips,
    calls,
    blobs,
    views: {
      async getTipForPanel(tipId) {
        return tips.get(tipId) ?? null;
      },
      async getProgramme(programmeId) {
        return byProgramme.get(programmeId) ?? null;
      },
      async getTipPublic(tipId) {
        const tip = tips.get(tipId);
        return tip === undefined ? null : makePublic(tip);
      },
    },
    call: async (method, args) => {
      calls.push({ method, args });
      // A tip released on this fake chain looks the way one looks after the transaction landed, so the
      // watch's "stop reading what is answered" behaviour is exercised by the same code path as the release.
      if (method === "post_released_keys") {
        const tipId = Number(args.tip_id);
        const tip = tips.get(tipId);
        if (tip !== undefined) tips.set(tipId, { ...tip, released_keys: args.keys as SealedKey[] });
      }
      return { txHash: `tx-${calls.length}` };
    },
  };
};

/**
 * A place to put a loop's handle one assignment after the loop is built. The stop condition for these
 * tests lives inside the very `sleep` the loop is waiting on, so the reference has to be indirect — and an
 * indirect reference is worth naming, because it is the one thing in this file that is a pattern rather
 * than data.
 */
export const lateHandle = (): { current?: Running } => ({});

/** The tipster's half of S-6.5: `K_switch` sealed to the keeper, uploaded, its CID written on the tip. */
export const sealKeeperCopy = async (
  switchKey: Uint8Array,
  keeperPublicKey: Uint8Array,
  blobs: BlobIO,
): Promise<string> => await blobs.put(await sealTo(switchKey, keeperPublicKey));
