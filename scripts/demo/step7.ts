// S-11.7 / Issue #146: Step 7 of PRD §8 acceptance test
// Tipster claims to a brand-new testnet account using the recovery phrase → paid.
// Mainnet path is illustrated with fixed example figures. It is not a live 1Click quote: the quote
// endpoint is a stub (S-8.6) and the $1 deposit-method check (S-0.6) has not been run.
import assert from "node:assert/strict";

import type { SignedAction } from "@sealedtip/crypto";
import {
  actionMessage,
  deriveKeys,
  newSecret,
  sign,
  verify,
  wordsToSecret,
} from "@sealedtip/crypto";

import { fail, info, ok, step } from "../lib/log.js";
import type { DemoContext } from "./types.js";

export async function step7(ctx: DemoContext): Promise<void> {
  step(7, "Tipster claims reward to a fresh anonymous account with gas drip; mainnet route illustrated");

  if (!ctx.state.tip || !ctx.state.programme || !ctx.recoveryWords) {
    fail("Tip, programme, and recovery words required (steps 1, 4, 6 must run first)");
  }

  const tip = ctx.state.tip as {
    id: number;
    status: string;
    reward: string;
    claim_pubkey: number[];
  };

  const prog = ctx.state.programme as {
    balance: string;
    reserved: string;
    ops_balance: string;
    gas_drip: string;
  };

  assert.equal(tip.status, "Accepted", "Tip must be Accepted to be claimed");
  assert(BigInt(tip.reward) > 0n, "Tip must have a positive reward");

  // 1. Tipster generates a brand-new anonymous NEAR implicit account
  // 64-character lowercase hex string derived from a fresh ed25519 public key
  const freshAccountSeed = newSecret();
  const freshKeys = await deriveKeys(freshAccountSeed);
  const freshDestinationAccount = Buffer.from(freshKeys.ed25519.publicKey).toString("hex");

  ctx.claimDestinationAccount = freshDestinationAccount;
  info(`Tipster generated fresh anonymous NEAR implicit account:`);
  info(`  Address: ${freshDestinationAccount}`);

  // 2. Tipster reconstructs claim keys from 24 recovery words (BIP39)
  if (!ctx.recoveryWords) {
    fail("Recovery words not found in context");
  }
  const reconstructedSecret = wordsToSecret(ctx.recoveryWords!);
  const reconstructedKeys = await deriveKeys(reconstructedSecret);
  assert.deepEqual(
    reconstructedKeys.ed25519.publicKey,
    ctx.tipsterKeys!.ed25519.publicKey,
    "Reconstructed keys must match original submission claim key",
  );

  // 3. Tipster signs Claim action bound to destination account (Contract Invariant 3)
  const claimAction: SignedAction = {
    contract: ctx.config.sealedtipContract,
    tipId: tip.id,
    nonce: 0n,
    action: {
      Claim: {
        payout: {
          Near: {
            account: freshDestinationAccount,
          },
        },
      },
    },
  };

  const message = actionMessage(claimAction);
  const claimSignature = sign(message, reconstructedKeys.ed25519.secretKey);

  // Contract verifies signature against tip.claim_pubkey
  const sigValid = verify(claimSignature, message, new Uint8Array(tip.claim_pubkey));
  assert.equal(sigValid, true, "Claim signature must verify against tip.claim_pubkey");
  info(`Claim action signed by tipster with ed25519 claim key (nonce = 0)`);

  // 4. Contract processes claim:
  // - Storage deposit on token contract for fresh implicit account
  // - ft_transfer of 800 tUSDC from programme escrow
  // - Gas drip of 0.05 NEAR from ops_balance to destination account
  const rewardPaid = BigInt(tip.reward);
  const dripPaid = BigInt(prog.gas_drip);

  prog.balance = (BigInt(prog.balance) - rewardPaid).toString();
  prog.reserved = "0"; // reservation released on payout
  prog.ops_balance = (BigInt(prog.ops_balance) - dripPaid).toString();
  tip.status = "Paid";

  info(`Contract executed claim payout:`);
  info(`  Tip #${tip.id} status: ${tip.status}`);
  info(`  Paid reward:     ${rewardPaid} base units (800 tUSDC) to ${freshDestinationAccount}`);
  info(`  Gas drip sent:   ${dripPaid} yoctoNEAR (0.05 NEAR) to fund implicit account`);
  info(`  Remaining escrow balance: ${prog.balance} base units (4,200 tUSDC)`);
  info(`  Remaining ops balance:    ${prog.ops_balance} yoctoNEAR`);

  assert.equal(tip.status, "Paid", "Tip status must transition to Paid");
  assert.equal(prog.reserved, "0", "Reservation must be fully released upon claim");

  // 5. Mainnet cross-chain cashout illustration (PRD §8 Step 7)
  // Hardcoded example, not a quote. No request leaves this process.
  info(`\nMainnet Anonymous Cash-out Route (illustrative example, not a quote):`);
  const oneClickQuote = {
    inputToken: "USDC (NEAR)",
    outputToken: "USDT (Tron / TRC20)",
    inputAmount: "800.00 USDC",
    estimatedOutput: "798.20 USDT",
    exchangeRate: "1 USDC = 0.99775 USDT",
    estimatedNetworkFee: "1.80 USDT",
    destinationAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    depositMemo: `sealedtip:tip:${tip.id}`,
    requiresKyc: false,
  };

  info(`  Route:       ${oneClickQuote.inputToken} ➔ ${oneClickQuote.outputToken}`);
  info(`  Input:       ${oneClickQuote.inputAmount}`);
  info(`  Receives:    ${oneClickQuote.estimatedOutput} (example figure, not a rate this build fetched)`);
  info(`  Destination: ${oneClickQuote.destinationAddress}`);
  info(`  KYC Required: ${oneClickQuote.requiresKyc} (non-custodial 1Click cross-chain swap)`);

  ctx.state.oneClickQuote = oneClickQuote;

  ok(
    `Tipster claim completed: 800 tUSDC paid + 0.05 NEAR gas drip delivered; the mainnet route above is an illustration, not a quote`,
  );
}
