// S-10.1: the deployment coordinates a tipster's page is built against. Two rules matter more than the
// rest, and both are about a judge's first screen rather than about a tipster's privacy.
//
// The first is that a broken `.env` must produce sentences. A page that renders `undefined` into an RPC
// URL, or throws a zod error with a stack, is a page that looks like an outage in the product.
//
// The second is that a missing value must not be guessed at. `NEXT_PUBLIC_SEALEDTIP_CONTRACT` has no
// default on purpose: a tip read from the wrong contract is a tip that does not exist, and "the demo
// pointed at somebody else's deployment" is exactly the kind of bug nobody finds until the judging.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { daysToNs, readPublicConfig } from "../lib/config";

/** What a working deployment looks like: one required variable and the placeholder filled in. */
const deployed = { NEXT_PUBLIC_SEALEDTIP_CONTRACT: "sealedtip.st-hack-f8d075.testnet" };

describe("the public config", () => {
  it("takes the network, the endpoint and the API from the deployment defaults around the one value it needs", () => {
    const result = readPublicConfig(deployed);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.contractId, "sealedtip.st-hack-f8d075.testnet");
    assert.equal(result.config.network, "testnet", "testnet is the default because mainnet is not a demo");
    assert.equal(result.config.rpcUrl, "https://rpc.testnet.fastnear.com");
    assert.equal(result.config.apiUrl, "http://localhost:8787");
    assert.equal(result.config.tokenContract, null, "the funder page needs a token; the tipster page does not");
  });

  it("refuses to build a page with no contract rather than point it at a guess", () => {
    const result = readPublicConfig({});
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.problems.some((line) => line.includes("NEXT_PUBLIC_SEALEDTIP_CONTRACT is not set")),
      `expected the one problem a first-time operator can act on, got ${JSON.stringify(result.problems)}`,
    );
  });

  it("names the placeholder that ships in .env.example instead of reading from it", () => {
    // The value in `.env.example` verbatim, because that is the string on the judge's screen when they
    // copy the file. It is not a legal account id, so only an explicit check turns it into an instruction.
    for (const placeholder of ["sealedtip.<you>.testnet", "sealedtip.example.testnet"]) {
      const result = readPublicConfig({ NEXT_PUBLIC_SEALEDTIP_CONTRACT: placeholder });
      assert.equal(result.ok, false, `${placeholder} is not a deployment`);
      if (result.ok) return;
      assert.match(result.problems.join("\n"), /still the placeholder/);
    }
  });

  it("treats an empty variable as an absent one, because that is how .env files fail", () => {
    const result = readPublicConfig({ ...deployed, NEXT_PUBLIC_API_URL: "  " });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.apiUrl, "http://localhost:8787");
  });

  it("forgives the trailing slash everyone types and removes it", () => {
    const result = readPublicConfig({ ...deployed, NEXT_PUBLIC_API_URL: "https://api.example.test/" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // `apiUrl + "/blob"` is how every caller uses this, so a kept slash becomes `//blob` on the wire.
    assert.equal(result.config.apiUrl, "https://api.example.test");
  });

  it("refuses a base with a path, which is a value copied out of a log line", () => {
    for (const bad of ["https://api.example.test/v1", "ftp://api.example.test", "not a url", "/api"]) {
      const result = readPublicConfig({ ...deployed, NEXT_PUBLIC_API_URL: bad });
      assert.equal(result.ok, false, `${bad} is not an origin`);
    }
  });

  it("refuses a contract id the chain would not accept, and says which field is wrong", () => {
    const result = readPublicConfig({ NEXT_PUBLIC_SEALEDTIP_CONTRACT: "Sealed Tip.testnet" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.problems.join("\n"), /^NEXT_PUBLIC_SEALEDTIP_CONTRACT: /);
  });

  it("keeps the network to the three the SDK knows", () => {
    assert.equal(readPublicConfig({ ...deployed, NEXT_PUBLIC_NEAR_NETWORK: "localnet" }).ok, false);
    for (const network of ["testnet", "mainnet", "betanet"]) {
      const result = readPublicConfig({ ...deployed, NEXT_PUBLIC_NEAR_NETWORK: network });
      assert.equal(result.ok, true, `${network} is a NEAR network`);
    }
  });
});

describe("the interval a tipster picks in days", () => {
  it("reaches the contract as nanoseconds, exactly", () => {
    // `Switch.interval` is `U64` ns and the fixture's armed tip says 86400000000000 for a day: this is the
    // number that has to match the chain's unit, not a duration the page formats for a human.
    assert.equal(daysToNs(1), "86400000000000");
    assert.equal(daysToNs(7), "604800000000000");
    assert.equal(daysToNs(1 / 1440), "60000000000", "one minute, at demo time scale");
  });

  it("refuses a switch that could never fire", () => {
    for (const days of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => daysToNs(days), RangeError, `${days} is not an interval`);
    }
  });
});
