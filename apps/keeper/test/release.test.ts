// S-9.3, the release. What is worth testing is not that the keeper can move data — it is the two promises
// the tipster is sold: that a recused member never gets the switch key, and that nothing is posted for a
// switch that has not fired. Both are checked against real sealed boxes, so "never" means *cannot open*,
// not *was not named*.
import assert from "node:assert/strict";
import { test } from "node:test";

import { fromHex, openSealed } from "@sealedtip/crypto";

import { release, type ReleaseDeps } from "../src/release.js";

import { type Chain, type Member, fakeChain, makeTip, newMembers, sealKeeperCopy } from "./support.js";

const K_SWITCH = fromHex("11".repeat(32));

interface Fixture {
  readonly chain: Chain;
  readonly keeper: Member;
  readonly members: readonly Member[];
  readonly cid: string;
  readonly deps: ReleaseDeps;
}

/** Three members, one tip, the switch key sealed to the keeper and uploaded the way the client does it. */
const setup = async (options: { triggered?: boolean; recused?: string[]; keeperCid?: string } = {}): Promise<Fixture> => {
  const members = await newMembers(3);
  const keeper = members[0]!;
  const chain = fakeChain(members);
  const cid = await sealKeeperCopy(K_SWITCH, keeper.keyPair.publicKey, chain.blobs);
  const tip = makeTip(0, {
    triggered: options.triggered ?? true,
    recused: options.recused ?? [],
    keeperCid: options.keeperCid ?? cid,
  });
  chain.tips.set(0, tip);

  return {
    chain,
    keeper,
    members,
    cid,
    deps: {
      views: chain.views,
      blobs: chain.blobs,
      call: chain.call,
      keeperX25519: { publicKey: keeper.keyPair.publicKey, secret: keeper.keyPair.secretKey },
    },
  };
};

const posted = (chain: Chain): { member: string; cid: string }[] =>
  (chain.calls[0]?.args.keys as { member: string; cid: string }[]) ?? [];

test("the switch key is re-sealed to every member the tipster did not recuse", async () => {
  const fixture = await setup();
  const outcome = await release(0, fixture.deps);
  assert.equal("skipped" in outcome, false, "a triggered, unreleased tip was skipped");
  if ("skipped" in outcome) return;

  assert.equal(outcome.posted.length, 3, "one sealed box per panel member");
  assert.equal(fixture.chain.calls.length, 1);
  assert.equal(fixture.chain.calls[0]?.method, "post_released_keys");
  assert.deepEqual(Object.keys(fixture.chain.calls[0]?.args ?? {}).sort(), ["keys", "tip_id"]);
  assert.equal(fixture.chain.calls[0]?.args.tip_id, 0);

  // Each entry must be that member's own box, and it must carry the switch key — the promise the contract
  // cannot check for itself (switch.rs: it validates the name, not the bytes under the pointer).
  for (const entry of outcome.posted) {
    const member = fixture.members.find((candidate) => candidate.account === entry.member);
    assert.ok(member, `posted a key for ${entry.member}, who is not on the panel`);
    const box = fixture.chain.blobs.store.get(entry.cid);
    assert.ok(box, `${entry.cid} was never uploaded`);
    assert.deepEqual(
      Array.from(await openSealed(box, member.keyPair.publicKey, member.keyPair.secretKey)),
      Array.from(K_SWITCH),
    );
  }
});

test("a recused member never receives the key, and cannot open anything that was posted", async () => {
  const recused = "member-3.testnet";
  const fixture = await setup({ recused: [recused] });
  const outcome = await release(0, fixture.deps);
  if ("skipped" in outcome) assert.fail("a release to two members was skipped");

  assert.deepEqual(
    outcome.posted.map((entry) => entry.member).sort(),
    ["member-1.testnet", "member-2.testnet"],
    "the recused member was named in the release",
  );

  // The stronger half. The recused reviewer holds a real X25519 secret; whatever the keeper uploaded, that
  // secret must not open it. Sealing to a different key is what makes this true by construction, and a
  // keeper that reused one box for everyone would fail here rather than in a judge's demo.
  const member3 = fixture.members.find((member) => member.account === recused)!;
  for (const [cid, bytes] of fixture.chain.blobs.store) {
    if (cid === fixture.cid) continue; // the tipster's own box for the keeper, which member 3 cannot open either
    await assert.rejects(
      openSealed(bytes, member3.keyPair.publicKey, member3.keyPair.secretKey),
      `a posted box (${cid}) opened with the recused member's key`,
    );
  }
});

test("a keeper that recused everybody posts nothing", async () => {
  const all = ["member-1.testnet", "member-2.testnet", "member-3.testnet"];
  const fixture = await setup({ recused: all });
  await assert.rejects(release(0, fixture.deps), /nobody to\s+release to/);
  assert.equal(fixture.chain.calls.length, 0, "an empty key set was posted, which would mark the switch answered");
});

test("nothing is released for a switch that has not fired", async () => {
  const fixture = await setup({ triggered: false });
  await assert.rejects(release(0, fixture.deps), /has not fired/);
  assert.equal(fixture.chain.calls.length, 0);
  assert.equal(fixture.chain.blobs.store.size, 1, "only the tipster's box is in the store; the keeper added nothing");
});

test("a tip with no switch has nothing to release", async () => {
  const fixture = await setup();
  fixture.chain.tips.set(0, makeTip(0, { hasSwitch: false }));
  await assert.rejects(release(0, fixture.deps), /no dead man's switch/);
  assert.equal(fixture.chain.calls.length, 0);
});

test("an already-released tip is left alone rather than re-posted", async () => {
  const fixture = await setup();
  const first = await release(0, fixture.deps);
  if ("skipped" in first) assert.fail("the first release was skipped");
  assert.equal(posted(fixture.chain).length, 3);

  // `post_released_keys` replaces rather than appends (switch.rs), so a second post is not merely wasteful:
  // it is a new transaction and a new set the panel would have to re-fetch for nothing.
  const second = await release(0, fixture.deps);
  assert.deepEqual(second, { tipId: 0, posted: [], skipped: "already-released" });
  assert.equal(fixture.chain.calls.length, 1, "a second transaction was sent for a released tip");
});

test("a tip that does not exist is refused before anything is read", async () => {
  const fixture = await setup();
  fixture.chain.tips.clear();
  await assert.rejects(release(7, fixture.deps), /tip 7 does not exist/);
  assert.equal(fixture.chain.calls.length, 0);
});

test("a missing keeper blob stops the release instead of posting pointers to nothing", async () => {
  const fixture = await setup({ keeperCid: "00".repeat(32) });
  await assert.rejects(release(0, fixture.deps), /not in the store/);
  assert.equal(fixture.chain.calls.length, 0);
});

test("a keeper key that is not the one on chain opens nothing and posts nothing", async () => {
  const fixture = await setup();
  const wrong = await newMembers(1);
  const outcome = await release(0, {
    ...fixture.deps,
    keeperX25519: { publicKey: wrong[0]!.keyPair.publicKey, secret: wrong[0]!.keyPair.secretKey },
  }).then(
    () => "released",
    (error: unknown) => error,
  );
  assert.ok(outcome instanceof Error, "a release happened with the wrong keeper secret");
  assert.match(String(outcome), /did not open with this keeper's X25519 secret/);
  assert.equal(fixture.chain.calls.length, 0);
  assert.equal(fixture.chain.blobs.store.size, 1, "the keeper uploaded re-sealed boxes it could not have made");
});

test("an unknown programme stops the release", async () => {
  const fixture = await setup();
  fixture.chain.tips.set(0, makeTip(0, { programmeId: 42, triggered: true }));
  await assert.rejects(release(0, fixture.deps), /programme 42, which does not exist/);
  assert.equal(fixture.chain.calls.length, 0);
});

test("one box per member, sealed separately, never one box shared by the panel", async () => {
  const fixture = await setup();
  const outcome = await release(0, fixture.deps);
  if ("skipped" in outcome) assert.fail("the release was skipped");

  // `crypto_box_seal` uses a fresh ephemeral key per call, so three boxes carrying the same key hash
  // differently. Equal CIDs would mean the keeper wrote one box and named three people — a release that
  // only the first of them can read, and a store entry everybody can correlate.
  const cids = outcome.posted.map((entry) => entry.cid);
  assert.equal(new Set(cids).size, 3, `only ${new Set(cids).size} distinct boxes for three members`);
  assert.equal(fixture.chain.blobs.store.size, 4, "three member boxes plus the tipster's copy for the keeper");
});
