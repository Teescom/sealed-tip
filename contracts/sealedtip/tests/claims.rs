//! Claims over RPC (ROADMAP S-5.5): does the reward actually reach the address the tipster signed,
//! and does anything that stops short of that leave the books honest?
//!
//! `src/claim.rs` and `src/token.rs` check the arithmetic in-process. What only a sandbox can check is
//! the three things a payout is made of — that `storage_deposit` registers a stranger, that the drip
//! brings an implicit account into existence, that a real NEP-141 token's refusal is what the rollback
//! callback is watching for. Every test here reads balances through RPC rather than through the
//! contract's own bookkeeping, because a contract that debits its ledger and pays nobody is exactly
//! the bug this suite exists to catch.
mod common;

use common::{implicit_id, Env, Submission};
use near_workspaces::types::NearToken;
use sealedtip::claim::STORAGE_DEPOSIT;
use sealedtip::types::{Action, Payout};
use serde_json::json;

const HOUR_NS: u64 = 3_600_000_000_000;
const DAY_NS: u64 = 24 * HOUR_NS;
/// 1 NEAR: what `open_programme` attached, and therefore the whole `ops_balance` these tests start at.
const OPS: u128 = common::OPS_START;
/// The `gas_drip` the harness puts into every programme (50 mNEAR).
const DRIP: u128 = common::GAS_DRIP;

fn payout_to(account: &near_workspaces::AccountId) -> Payout {
    Payout::Near {
        account: account.clone(),
    }
}

fn intents_to(deposit_address: &near_workspaces::AccountId) -> Payout {
    Payout::Intents {
        deposit_address: deposit_address.clone(),
        memo: Some("q-1234".to_string()),
    }
}

#[tokio::test]
async fn the_storage_deposit_constant_is_the_deployed_tokens_minimum() {
    // `claim` cannot read the token's `storage_balance_bounds` mid-transaction, so the amount it
    // attaches is a constant in the contract and this is where it is checked against the wasm that is
    // actually deployed. Too little and every claim on testnet is refused; too much and the surplus is
    // refunded to the contract, where it stops being in `ops_balance` and nobody can withdraw it.
    let env = Env::setup().await;
    let min = env.storage_minimum().await;
    assert_eq!(
        STORAGE_DEPOSIT.as_yoctonear(),
        min.as_yoctonear(),
        "sealedtip::claim::STORAGE_DEPOSIT is {} yoctoNEAR but the deployed token wants {}",
        STORAGE_DEPOSIT.as_yoctonear(),
        min.as_yoctonear(),
    );
    // The equality above is only worth anything if the number read from `storage_balance_bounds` is
    // the number the token enforces. One micronear under it, and the answer had better be no.
    env.storage_floor_is_enforced(NearToken::from_micronear(1))
        .await;
}

#[tokio::test]
async fn claim_registers_storage_and_sends_gas_drip() {
    let env = Env::setup().await;
    let (programme_id, tip_id) = env.accepted_tip(200).await;
    let destination = implicit_id("claim.destination");

    // The state a tipster's wallet hands over: an account that does not exist yet, is not registered
    // with the token, and holds nothing.
    assert_eq!(env.near_balance_of(&destination).await, None);
    assert_eq!(env.storage_total(&destination).await, None);
    assert_eq!(env.tusdc_balance(&destination).await, 0);
    let escrow_before = env.tusdc_balance(env.sealedtip.id()).await;
    let ops_before = env.ops_balance(programme_id).await;

    // The other relayer forwards it, because the tipster does not choose which one calls.
    let claim = env
        .claim(&env.relayer_2, tip_id, &payout_to(&destination), 1)
        .await;
    claim.expect_paid();

    // All three things the payout is made of happened, and each is read from the contract that owns it.
    assert_eq!(
        env.tusdc_balance(&destination).await,
        200 * common::UNIT,
        "the reward did not reach the address the tipster signed"
    );
    assert_eq!(
        env.storage_total(&destination).await,
        Some(STORAGE_DEPOSIT.as_yoctonear()),
        "the destination was not registered at exactly the deposit the contract attaches"
    );
    assert_eq!(
        env.near_balance_of(&destination)
            .await
            .expect("the gas drip should have brought the implicit account into existence")
            .as_yoctonear(),
        DRIP,
        "without the drip the tipster has a balance they cannot spend"
    );
    assert_eq!(
        env.tusdc_balance(env.sealedtip.id()).await,
        escrow_before - 200 * common::UNIT,
        "the escrow, not the token's total supply, paid"
    );
    assert_eq!(
        env.ops_balance(programme_id).await,
        ops_before - STORAGE_DEPOSIT.as_yoctonear() - DRIP,
        "and the programme's NEAR paid for both, once each"
    );

    // The books: the reward left the escrow and the reservation behind it is gone, so the funder can
    // withdraw it. That is the only observable difference between "released" and "still committed".
    assert_eq!(
        env.programme_money(programme_id).await,
        (800 * common::UNIT, 0),
        "the paid reward must stop blocking the funder"
    );
    assert_eq!(env.tip_status(tip_id).await, "Paid");
    assert_eq!(claim.paid_events(), 1, "the watcher saw exactly one payout");

    // And the money really is withdrawable afterwards, which is what `reserved` is for.
    env.withdraw_check(programme_id, 800)
        .await
        .expect("800 of the programme is unreserved once the claim is paid");
}

#[tokio::test]
async fn claim_only_when_accepted() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission {
                switch: Some((DAY_NS, 4 * HOUR_NS)),
                ..Submission::new(programme_id, &env.member_1, &env.member_2)
            },
        )
        .await
        .expect("an honest submission should be stored");
    let destination = implicit_id("claim.status.destination");
    let payout = payout_to(&destination);

    // `Submitted` has no reward attached to it yet, and `UnderReview` is a belief, not a decision.
    let claim = env.claim(&env.relayer_1, tip_id, &payout, 1).await;
    assert!(
        claim.said("E14_INVALID_STATUS"),
        "a Submitted tip was claimable: {}",
        claim.report()
    );
    assert_eq!(env.tip_status(tip_id).await, "Submitted");
    assert_eq!(env.tusdc_balance(&destination).await, 0);

    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("a panel member should be able to triage");
    let claim = env.claim(&env.relayer_1, tip_id, &payout, 1).await;
    assert!(
        claim.said("E14_INVALID_STATUS"),
        "an UnderReview tip was claimable: {}",
        claim.report()
    );
    assert_eq!(env.tip_status(tip_id).await, "UnderReview");
    assert_eq!(env.tusdc_balance(&destination).await, 0);
    assert_eq!(
        env.ops_balance(programme_id).await,
        OPS,
        "a refused claim spent the programme's NEAR"
    );

    // A rejected tip pays nothing either — the DAO said no, and no signature can turn that into yes.
    env.call(
        &env.panel_dao,
        "resolve_tip",
        json!({ "tip_id": tip_id, "accept": false, "reward": null }),
    )
    .await
    .expect("the DAO should be able to reject");
    let claim = env.claim(&env.relayer_1, tip_id, &payout, 1).await;
    assert!(
        claim.said("E14_INVALID_STATUS"),
        "a rejected tip was claimable: {}",
        claim.report()
    );
    assert_eq!(env.tip_status(tip_id).await, "Rejected");

    // A relayer cannot choose to be the one who decides either: the tipster's signature buys the
    // payout, only the DAO's vote makes it owed.
    env.call(
        &env.relayer_1,
        "resolve_tip",
        json!({ "tip_id": tip_id, "accept": true, "reward": null }),
    )
    .await
    .expect_err("a relayer is not the panel DAO");

    // The positive control: the same signature machinery, on a tip the DAO did accept.
    let (_, accepted) = env.accepted_tip(200).await;
    env.claim(&env.relayer_1, accepted, &payout, 1)
        .await
        .expect_paid();
    assert_eq!(env.tip_status(accepted).await, "Paid");

    // And `Paid` is not re-claimable — this is the double-payout case, with a fresh nonce and a
    // signature that is valid for exactly what it asks for.
    let claim = env.claim(&env.relayer_2, accepted, &payout, 2).await;
    assert!(
        claim.said("E14_INVALID_STATUS"),
        "a paid tip could be claimed twice: {}",
        claim.report()
    );
    assert_eq!(
        env.tusdc_balance(&destination).await,
        200 * common::UNIT,
        "the second claim moved money"
    );
}

#[tokio::test]
async fn a_relayer_cannot_redirect_a_reward() {
    // PRD F8, on chain: the payout destination is inside the bytes the tipster signed, so the party
    // that forwards the claim — and picks the address in the call — cannot pick one the tipster did
    // not authorise. This is the case a signature over `tip_id` and `nonce` alone would leave open.
    let env = Env::setup().await;
    let (programme_id, tip_id) = env.accepted_tip(200).await;
    let honest = implicit_id("claim.honest.destination");
    let thief = implicit_id("claim.thief.destination");

    let signature = env.signed_action(
        tip_id,
        1,
        Action::Claim {
            payout: payout_to(&honest),
        },
    );
    let claim = env
        .claim_with(&env.relayer_1, tip_id, &payout_to(&thief), 1, &signature)
        .await;
    assert!(
        claim.said("E09_BAD_SIGNATURE"),
        "a payout redirected to another account was not refused: {}",
        claim.report()
    );
    assert_eq!(env.tip_status(tip_id).await, "Accepted");
    assert_eq!(env.tusdc_balance(&thief).await, 0, "the thief was paid");
    assert_eq!(
        env.tusdc_balance(&honest).await,
        0,
        "and nobody else was either"
    );
    assert_eq!(
        env.programme_money(programme_id).await,
        (1_000 * common::UNIT, 200 * common::UNIT),
        "a refused redirect moved the escrow"
    );
    assert_eq!(
        env.ops_balance(programme_id).await,
        OPS,
        "or spent the programme's NEAR"
    );

    // The tipster's own signature is untouched: the refusal happened at the entry point, so the next
    // honest claim with the same nonce is still spendable.
    let claim = env
        .claim(&env.relayer_1, tip_id, &payout_to(&honest), 1)
        .await;
    claim.expect_paid();
    assert_eq!(env.tusdc_balance(&honest).await, 200 * common::UNIT);
}

#[tokio::test]
async fn failed_transfer_rolls_back_to_accepted() {
    // The failure is real, not mocked: the escrow is deregistered from the token, so the token itself
    // refuses the `ft_transfer` the way it would refuse any unpayable sender. Everything else — the
    // storage deposit, the drip, the entry point — runs as it does on testnet.
    let env = Env::setup().await;
    let (programme_id, tip_id) = env.accepted_tip(200).await;
    let destination = implicit_id("claim.rollback.destination");
    let payout = payout_to(&destination);
    env.unregister(env.sealedtip.as_account()).await;

    let claim = env.claim(&env.relayer_1, tip_id, &payout, 1).await;
    assert!(
        !claim.succeeded(),
        "the token was supposed to refuse this transfer, and the books would now lie"
    );
    assert_eq!(
        env.tip_status(tip_id).await,
        "Accepted",
        "a payout that did not happen must not be recorded as one"
    );
    assert_eq!(
        env.programme_money(programme_id).await,
        (1_000 * common::UNIT, 200 * common::UNIT),
        "the reward came back to the escrow and is still committed to this tip"
    );
    assert_eq!(
        env.tusdc_balance(&destination).await,
        0,
        "the tipster was not paid"
    );
    assert_eq!(claim.paid_events(), 0, "and no watcher was told they were");
    // The drip is a separate action in the same batch as the two token calls, so it lands whether or
    // not the payout did. That is the reason `on_claim_paid` deliberately does not refund
    // `ops_balance`: a callback cannot un-send NEAR that already left the account, and pretending it
    // could would leave the books claiming money the programme no longer has.
    assert_eq!(
        env.near_balance_of(&destination)
            .await
            .map(|balance| balance.as_yoctonear()),
        Some(DRIP),
        "the failed payout still dripped, which is what the unrefunded ops balance is paying for"
    );

    // What the claim did spend is not refunded, and the number is exact rather than "less than": the
    // deposit and the drip really left the programme's NEAR, so a book that still showed the starting
    // balance would be money the funder could try to withdraw and could not.
    assert_eq!(
        env.ops_balance(programme_id).await,
        OPS - STORAGE_DEPOSIT.as_yoctonear() - DRIP,
        "the rolled-back claim should have cost exactly the deposit and the drip"
    );

    // The retry rule, at the level a sandbox can see it: the refused claim spent nonce 1, so the
    // tipster's next action is nonce 2, and a second failure rolls back to the same escrow books.
    // What it does *not* roll back to is the ops balance — each attempt buys its own deposit and its
    // own drip, and the limit on that is `E32_OPS_BALANCE_TOO_LOW` plus the nonce sequence, not a
    // callback that cannot reach a NEAR transfer already made.
    let second = env.claim(&env.relayer_2, tip_id, &payout, 2).await;
    assert!(
        !second.succeeded(),
        "the token should still refuse, and the retry should still roll back: {}",
        second.report()
    );
    assert_eq!(
        (
            env.programme_money(programme_id).await,
            env.tip_status(tip_id).await
        ),
        (
            (1_000 * common::UNIT, 200 * common::UNIT),
            "Accepted".to_string()
        ),
        "two failures left the escrow and the tip exactly as one did"
    );
    assert_eq!(
        env.ops_balance(programme_id).await,
        OPS - 2 * (STORAGE_DEPOSIT.as_yoctonear() + DRIP),
        "the second attempt cost the programme a second deposit and a second drip"
    );
    assert_eq!(env.tusdc_balance(&destination).await, 0);
    assert_eq!(second.paid_events(), 0);

    // A gap is not allowed, so a relayer that skipped the spent nonce is refused before anything else
    // runs — and that refusal is what keeps the retry sequence honest.
    let claim = env.claim(&env.relayer_1, tip_id, &payout, 4).await;
    assert!(
        claim.said("E10_BAD_NONCE"),
        "a nonce gap was accepted: {}",
        claim.report()
    );
}

#[tokio::test]
async fn a_rolled_back_claim_can_be_retried_once_the_token_will_pay() {
    // The point of the rollback is that a tipster is not stranded by a failure that was nobody's fault
    // but the token's. The forced unregister above destroyed the escrow's token balance, so this test
    // puts the money back the way a funder would — `ft_transfer_call` through the token — and then the
    // next nonce pays.
    let env = Env::setup().await;
    let (programme_id, tip_id) = env.accepted_tip(200).await;
    let destination = implicit_id("claim.retry.destination");
    let payout = payout_to(&destination);

    env.unregister(env.sealedtip.as_account()).await;
    let claim = env.claim(&env.relayer_1, tip_id, &payout, 1).await;
    assert!(
        !claim.succeeded() && env.tip_status(tip_id).await == "Accepted",
        "the setup wanted a refused payout, got: {}",
        claim.report()
    );

    env.register(env.sealedtip.as_account()).await;
    env.fund_programme(programme_id, 200).await;
    let claim = env.claim(&env.relayer_1, tip_id, &payout, 2).await;
    claim.expect_paid();

    assert_eq!(env.tip_status(tip_id).await, "Paid");
    assert_eq!(
        env.tusdc_balance(&destination).await,
        200 * common::UNIT,
        "the retry paid the same destination the first attempt signed for"
    );
    assert_eq!(
        env.near_balance_of(&destination)
            .await
            .expect("the retry should have dripped gas money")
            .as_yoctonear(),
        2 * DRIP,
        "two attempts, two drips — the first one was spent on a payout that did not happen and \
         `on_claim_paid` does not pretend to refund it"
    );
    // 1000 funded + 200 re-funded − 200 paid, with the 200 still committed until the callback released
    // it. The reservation is what makes the second `fund` safe rather than double-counting.
    assert_eq!(
        env.programme_money(programme_id).await,
        (1_000 * common::UNIT, 0),
        "one reward was paid and one reservation was released"
    );
    assert_eq!(claim.paid_events(), 1);
}

#[tokio::test]
async fn an_intents_payout_gets_the_reward_and_no_gas_drip() {
    // 1Click's deposit address is somebody else's account on this chain. The reward has to reach it —
    // that is the whole cross-chain leg — but funding it from the programme would spend ops NEAR to
    // top up an account no tipster here controls, so the drip is skipped and the account is left
    // uncreated.
    let env = Env::setup().await;
    let (programme_id, tip_id) = env.accepted_tip(200).await;
    let deposit = implicit_id("claim.1click.deposit-address");
    let payout = intents_to(&deposit);

    let claim = env.claim(&env.relayer_1, tip_id, &payout, 1).await;
    claim.expect_paid();

    assert_eq!(env.tusdc_balance(&deposit).await, 200 * common::UNIT);
    assert_eq!(
        env.near_balance_of(&deposit).await,
        None,
        "an Intents destination was funded from the programme's NEAR"
    );
    assert_eq!(
        env.ops_balance(programme_id).await,
        OPS - STORAGE_DEPOSIT.as_yoctonear(),
        "the deposit is the only thing an Intents payout costs"
    );
    // The memo is the routing information 1Click needs, and the NEP-141 memo is the only on-chain
    // place it can go. `ft_transfer` emits an `ft_transfer` event carrying it.
    assert!(
        claim.said("q-1234") && claim.said("sealedtip claim"),
        "the 1Click memo did not travel with the transfer: {}",
        claim.report()
    );
    assert_eq!(env.tip_status(tip_id).await, "Paid");
}

#[tokio::test]
async fn the_payout_callback_cannot_be_called_from_outside() {
    // `on_claim_paid` releases a reservation and, on a refusal, puts money back into the escrow. If
    // anybody could call it, a caller could inflate a programme balance or mark a tip paid; the guard
    // is that only this contract's own promise may reach it.
    let env = Env::setup().await;
    let (programme_id, tip_id) = env.accepted_tip(200).await;

    for caller in [
        &env.relayer_1,
        &env.funder,
        &env.keeper,
        &env.owner,
        &env.member_1,
    ] {
        let error = env
            .call(
                caller,
                "on_claim_paid",
                json!({ "result": null, "tip_id": tip_id, "amount": "200000000" }),
            )
            .await
            .expect_err("a callback is not an entry point for the public");
        assert!(
            error.contains("on_claim_paid is private"),
            "{} reached: {error}",
            caller.id()
        );
    }
    assert_eq!(
        (
            env.programme_money(programme_id).await,
            env.tip_status(tip_id).await
        ),
        (
            (1_000 * common::UNIT, 200 * common::UNIT),
            "Accepted".to_string()
        ),
        "five attempts to forge a payout moved nothing"
    );
}

#[tokio::test]
async fn a_zero_reward_claim_settles_the_tip_without_spending_near() {
    // A DAO can accept a tip as credible and vote it worth nothing. Such a tip has to be closable:
    // `retract` refuses anything the DAO has decided, so `claim` is the only way out — and it should
    // not have to buy a storage deposit or drip gas to pay zero.
    let env = Env::setup().await;
    let (programme_id, tip_id) = env.accepted_tip(0).await;
    let destination = implicit_id("claim.zero.destination");

    let claim = env
        .claim(&env.relayer_1, tip_id, &payout_to(&destination), 1)
        .await;
    claim.expect_paid();

    assert_eq!(env.tip_status(tip_id).await, "Paid");
    assert_eq!(
        env.ops_balance(programme_id).await,
        OPS,
        "a claim that pays nothing should cost nothing"
    );
    assert_eq!(
        env.near_balance_of(&destination).await,
        None,
        "and should not register or fund an account"
    );
    assert_eq!(env.storage_total(&destination).await, None);
    assert_eq!(
        env.programme_money(programme_id).await,
        (1_000 * common::UNIT, 0)
    );
    assert_eq!(claim.paid_events(), 1, "the watcher still saw it settle");
}

#[tokio::test]
async fn a_claim_needs_the_tipsters_signature_not_just_a_relayer() {
    // The role guard and the signature are two different doors, and a relayer allow-list is not an
    // authorisation to choose a payout. Both negative cases have to fail without spending anything,
    // because a relayer that can burn a nonce by guessing gets a free replay oracle.
    let env = Env::setup().await;
    let (programme_id, tip_id) = env.accepted_tip(200).await;
    let destination = implicit_id("claim.signature.destination");
    let payout = payout_to(&destination);

    let wrong_key = env.signed_action_wrong_key(
        tip_id,
        1,
        Action::Claim {
            payout: payout.clone(),
        },
    );
    let claim = env
        .claim_with(&env.relayer_1, tip_id, &payout, 1, &wrong_key)
        .await;
    assert!(
        claim.said("E09_BAD_SIGNATURE"),
        "an action signed by another key was accepted: {}",
        claim.report()
    );

    // A non-relayer holding the *right* signature is refused too — the tipster cannot pick who
    // forwards, and a panel member must not be able to spend a claim it never relayed.
    let claim = env
        .claim_with(
            &env.member_2,
            tip_id,
            &payout,
            1,
            &env.signed_action(
                tip_id,
                1,
                Action::Claim {
                    payout: payout.clone(),
                },
            ),
        )
        .await;
    assert!(
        claim.said("E04_NOT_RELAYER"),
        "a panel member forwarded a claim it had no part in: {}",
        claim.report()
    );

    assert_eq!(
        (
            env.programme_money(programme_id).await,
            env.ops_balance(programme_id).await,
            env.tip_status(tip_id).await,
        ),
        (
            (1_000 * common::UNIT, 200 * common::UNIT),
            OPS,
            "Accepted".to_string()
        ),
        "a refusal that costs the programme money is a denial of service"
    );

    let claim = env.claim(&env.relayer_1, tip_id, &payout, 1).await;
    claim.expect_paid();
    assert_eq!(env.tusdc_balance(&destination).await, 200 * common::UNIT);
}

#[tokio::test]
async fn a_programme_out_of_ops_near_refuses_the_next_claim() {
    // A payout starts by registering the destination with the token, and the token does not register
    // anybody for free: that deposit comes out of the programme's NEAR, not out of the escrow. A
    // programme with no NEAR left can therefore pay no more rewards at all — so E32 refuses it before
    // a single byte of state is written, and the thing that survives is the tipster's nonce, which is
    // what lets the very same signed action pay out the day the programme has NEAR again.
    let env = Env::setup().await;
    // The attachment *is* `ops_balance`, so this is a programme opened with exactly one storage
    // deposit and nothing to spare, at the smallest drip `create_programme` will accept (E24 wants the
    // attachment to cover the drip, so a drip of one yoctoNEAR is what leaves the whole deposit for
    // the part a claim cannot shrink).
    let programme_id = env
        .open_programme_cost(500, 0, 1, NearToken::from_yoctonear(1), STORAGE_DEPOSIT)
        .await
        .expect("a programme that can pay for one deposit is a legal programme");
    env.seat_panel(programme_id, &[&env.member_1, &env.member_2, &env.member_3])
        .await;
    env.register(env.sealedtip.as_account()).await;
    env.fund_programme(programme_id, 1_000).await;
    assert_eq!(
        env.programme_money(programme_id).await,
        (1_000 * common::UNIT, 0)
    );
    assert_eq!(
        env.ops_balance(programme_id).await,
        STORAGE_DEPOSIT.as_yoctonear(),
        "the whole attachment should have become ops_balance"
    );

    // The first claim is allowed, and it spends the last of the NEAR on the deposit.
    let first = env.accept_tip_on(programme_id, 200).await;
    let to_first = implicit_id("ops.first.destination");
    let claim = env
        .claim(&env.relayer_1, first, &payout_to(&to_first), 1)
        .await;
    claim.expect_paid();
    assert_eq!(
        env.storage_total(&to_first).await,
        Some(STORAGE_DEPOSIT.as_yoctonear()),
        "the deposit is what the programme's last NEAR bought"
    );
    assert_eq!(env.tusdc_balance(&to_first).await, 200 * common::UNIT);
    // The drip shrank to nothing rather than blocking the payout — the trade `claim` makes on purpose.
    // The blunt half of that trade is what this asserts: the tipster has a balance they cannot move
    // yet, and an account that was never brought into existence.
    assert_eq!(
        env.near_balance_of(&to_first).await,
        None,
        "a zero yoctoNEAR drip does not create the implicit account"
    );
    assert_eq!(env.ops_balance(programme_id).await, 0);

    // The second claim has nothing left to buy the deposit with.
    let second = env.accept_tip_on(programme_id, 200).await;
    let to_second = implicit_id("ops.second.destination");
    let refused = env
        .claim(&env.relayer_2, second, &payout_to(&to_second), 1)
        .await;
    assert!(
        !refused.succeeded(),
        "a programme with no NEAR paid a claim anyway: {}",
        refused.report()
    );
    assert!(
        refused.said("E32_OPS_BALANCE_TOO_LOW"),
        "the claim failed for something other than the ops floor: {}",
        refused.report()
    );

    // Everything the refusal was supposed to leave alone, left alone: the escrow and the reservation
    // for the tip that is still owed, the second tipster's unregistered destination, the tip's status,
    // and the nonce that makes the retry possible.
    assert_eq!(
        env.programme_money(programme_id).await,
        (800 * common::UNIT, 200 * common::UNIT),
        "a refused claim moved the money"
    );
    assert_eq!(env.storage_total(&to_second).await, None);
    assert_eq!(env.tusdc_balance(&to_second).await, 0);
    assert_eq!(env.tip_status(second).await, "Accepted");
    assert_eq!(
        env.tip_view(second).await["nonce"].as_u64(),
        Some(0),
        "a claim the contract refused consumed the tipster's nonce"
    );
    // And the money the refused tip is still committed against is the funder's to see: 600 of the
    // remaining 800 is unreserved, so the refusal stranded nothing that a closed programme cannot free.
    env.withdraw_check(programme_id, 600)
        .await
        .expect("600 of a thin programme is unreserved while one tip waits to be paid");
}
