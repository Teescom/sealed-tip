// The rules `verify-1click-quote.ts` grades against, tested without a network: a live probe that reads
// its own answer wrong is worse than no probe.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEPOSIT_TYPE,
  ORIGIN_ASSET_ID,
  REFUND_TYPE,
  assetIdsIn,
  amountOutOf,
  depositAddressOf,
  isDepositAddress,
  parseFloor,
  quoteRequest,
  refusalMessage,
} from "../lib/oneclick-quote.js";

test("parseFloor reads the floor out of the real refusal", () => {
  // Verbatim from the live API on 2026-11-13.
  assert.equal(
    parseFloor("Amount is too low for bridge, try at least 1870864"),
    1_870_864n,
    "the floor is base units, not USDC",
  );
  assert.equal(parseFloor(""), undefined);
  assert.equal(parseFloor("Internal server error"), undefined, "a 500 says nothing about a floor");
});

test("isDepositAddress accepts only the 64-hex implicit account the claim signs", () => {
  assert.equal(isDepositAddress("017aeb4bf9f93cb6cb4d576f4d62d9a71b086815e40634b59c7c18ca587a0a8d"), true);
  assert.equal(isDepositAddress("017AEB4BF9F93CB6CB4D576F4D62D9A71B086815E40634B59C7C18CA587A0A8D"), false);
  assert.equal(isDepositAddress("017aeb4bf9f93cb6cb4d576f4d62d9a71b086815e40634b59c7c18ca587a0a8"), false);
  assert.equal(isDepositAddress("sealedtip.st-deployer-f8d075.testnet"), false);
  assert.equal(isDepositAddress(undefined), false, "a dry quote has no address, and that is not a pass");
});

test("assetIdsIn reads the ids the proxy ships and nothing from its prose", () => {
  const source = `
    export const ASSETS = {
      "USDC.near": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      "Tron USDT": "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
    };
    const RAW_ID = /^(nep141|nep245):[A-Za-z0-9._:-]+$/;
  `;
  assert.deepEqual(assetIdsIn(source), [
    "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
  ]);
  assert.deepEqual(assetIdsIn("no ids here"), []);
});

test("quoteRequest sends the deposit type the contract can pay, and a deadline it can sign inside", () => {
  const now = Date.UTC(2026, 10, 13, 12, 0, 0);
  const request = quoteRequest("1870864", DEPOSIT_TYPE, REFUND_TYPE, now);

  assert.equal(request.depositType, "ORIGIN_CHAIN", "INTENTS means 'do not transfer on chain', which is not ours");
  assert.equal(request.refundType, "INTENTS", "refundType ORIGIN_CHAIN is the pairing the API answers 500 to");
  assert.equal(request.originAsset, ORIGIN_ASSET_ID);
  assert.equal(request.amount, "1870864", "amounts stay integer strings in base units");
  assert.equal(request.dry, false, "a dry quote carries no deposit address to sign");
  assert.equal(request.deadline, new Date(now + 10 * 60 * 1000).toISOString());
});

test("depositAddressOf and amountOutOf read the shape the live API returns", () => {
  const answer = {
    quote: { depositAddress: "017aeb4bf9f93cb6cb4d576f4d62d9a71b086815e40634b59c7c18ca587a0a8d", amountOut: "1019666" },
  };
  assert.equal(depositAddressOf(answer), "017aeb4bf9f93cb6cb4d576f4d62d9a71b086815e40634b59c7c18ca587a0a8d");
  assert.equal(amountOutOf(answer), "1019666");
  assert.equal(depositAddressOf({}), undefined);
  assert.equal(depositAddressOf({ quote: {} }), undefined);
});

test("refusalMessage never invents a reason", () => {
  assert.equal(refusalMessage({ message: "Amount is too low for bridge, try at least 1870864" }), "Amount is too low for bridge, try at least 1870864");
  assert.equal(refusalMessage({}), "");
  assert.equal(refusalMessage("a plain text body"), "");
  assert.equal(refusalMessage(null), "");
});
