// The release (S-9.3): open the tipster's sealed copy of `K_switch`, re-seal it to everyone on the panel
// the tipster did not recuse, upload each sealed box, and hand the CIDs to the contract.
//
// This is the one place in the repository that holds a bundle key and the only one that holds a live
// plaintext path — `K_switch` exists here for the few statements between `openSealed` and the last
// `sealTo`, and never leaves as anything but sealed bytes. That is what ARCHITECTURE §14.6 means by
// "the keeper is the only party that ever held `K_switch`", and it is why the contract can check *whose
// name* each released key carries but cannot check that the ciphertext under it is this key: nobody else
// could.
//
// The order is deliberate. Read the tip, refuse anything the contract would refuse (a tip with no switch,
// a switch that has not fired, an already-released tip), then do the work, then post. A refusal costs no
// gas and uploads nothing, so a keeper with a wrong idea of a tip leaves the chain exactly as it found it.
//
// Every message below names a tip id, a programme id, a CID, or the shape of the problem. None of them
// carries a key, a plaintext byte, or a sealed box.
import { type SealedKey, type ViewClient } from "@sealedtip/core";
import { openSealed, sealTo } from "@sealedtip/crypto";

import type { BlobIO } from "./blobs.js";
import type { KeeperCall } from "./near.js";

export interface ReleaseDeps {
  /** The panel path is the only view that carries `recused`, `released_keys` and the switch CID together. */
  readonly views: Pick<ViewClient, "getTipForPanel" | "getProgramme">;
  readonly blobs: BlobIO;
  readonly call: KeeperCall;
  /** Both halves, because `crypto_box_seal_open` needs the public key alongside the secret one. */
  readonly keeperX25519: { readonly publicKey: Uint8Array; readonly secret: Uint8Array };
}

/** What a release did: the entries handed to the contract, or why it posted nothing. */
export type ReleaseOutcome =
  | { readonly tipId: number; readonly posted: readonly SealedKey[]; readonly txHash: string }
  | { readonly tipId: number; readonly posted: readonly []; readonly skipped: "already-released" };

/** A CID is public on the tip, but a hostile tipster writes it, so it goes into a log line shortened. */
const shortCid = (cid: string): string => (cid.length > 80 ? `${cid.slice(0, 80)}…` : cid);

export const release = async (tipId: number, deps: ReleaseDeps): Promise<ReleaseOutcome> => {
  const tip = await deps.views.getTipForPanel(tipId);
  if (tip === null) throw new Error(`tip ${tipId} does not exist`);
  // Checked here, before any work, so the chain is never asked to refuse it with gas already spent. The
  // contract still re-checks both (E20 and E13) because a compromised keeper is the threat this row is
  // written against, not an honest one making an honest mistake.
  if (tip.switch === null) {
    throw new Error(`tip ${tip.id} has no dead man's switch, so there is nothing for a switch to release`);
  }
  if (!tip.switch.triggered) {
    throw new Error(
      `tip ${tip.id}'s switch has not fired. Releasing it now would answer a call the tipster has not made, ` +
        `which is what E20 means on the chain side`,
    );
  }

  if (tip.released_keys.length > 0) {
    return { tipId, posted: [], skipped: "already-released" };
  }

  const programme = await deps.views.getProgramme(tip.programme_id);
  if (programme === null) throw new Error(`tip ${tipId} names programme ${tip.programme_id}, which does not exist`);

  const recused = new Set(tip.recused);
  const recipients = programme.panel.filter((member) => !recused.has(member.account));
  if (recipients.length === 0) {
    // Posting an empty set would satisfy the contract and mark the tip answered. The switch says "give it
    // to the people I chose", so when the tipster has excluded everyone there is no release to make —
    // and silence that a human can see is better than a key set pointing at nobody.
    throw new Error(
      `every member of programme ${programme.id}'s panel is recused on tip ${tipId}: there is nobody to ` +
        `release to, so nothing was posted`,
    );
  }

  const sealedForKeeper = await deps.blobs.get(tip.switch.bundle_key_for_keeper);
  if (sealedForKeeper === null) {
    throw new Error(
      `the blob at ${shortCid(tip.switch.bundle_key_for_keeper)} is not in the store, so K_switch cannot be opened`,
    );
  }

  let switchKey: Uint8Array;
  try {
    switchKey = await openSealed(sealedForKeeper, deps.keeperX25519.publicKey, deps.keeperX25519.secret);
  } catch {
    // One message for every way sodium can refuse: the authentication failure and the short-box
    // `RangeError` have the same cause and the same fix. The library's own text is not passed on, because
    // a crypto exception is the one place a key could be echoed.
    throw new Error(
      `tip ${tipId}: the sealed copy of the switch key did not open with this keeper's X25519 secret, so the ` +
        `key on chain and the key in .env are not the same pair. Nothing was posted.`,
    );
  }

  const posted: SealedKey[] = [];
  for (const member of recipients) {
    // `sealTo` throws on a public half that is not 32 bytes, and `Programme`'s schema has already refused
    // a panel entry whose key is not exactly that length — so a malformed panel never reaches the store.
    const box = await sealTo(switchKey, Uint8Array.from(member.x25519_pub));
    posted.push({ member: member.account, cid: await deps.blobs.put(box) });
  }

  const { txHash } = await deps.call("post_released_keys", { tip_id: tipId, keys: posted });
  return { tipId, posted, txHash };
};
