//! The tipster's actions over RPC: what a signature has to be valid *for*, and what happens when it
//! isn't. ROADMAP S-5.3.
//!
//! The unit tests in `src/actions.rs` check the message builder and the nonce rule in-process. What
//! only a sandbox can check is the deployed pair: that the wasm actually calls `ed25519_verify`, that
//! the public key it verifies against is the one stored at submission, and that a refused action
//! leaves the tip exactly where it was. Each negative test here needs a positive control, because an
//! E09 that fires on every call — including the honest one — proves nothing about the rule.
mod common;

use common::{implicit_id, Env, Submission};
use sealedtip::types::{Action, Payout};
use serde_json::json;

const HOUR_NS: u64 = 3_600_000_000_000;
const DAY_NS: u64 = 24 * HOUR_NS;
/// The 1 NEAR `create_programme` attaches, which is the whole `ops_balance` a claim can spend.
const OPS: u128 = common::OPS_START;

/// A funded programme with one submitted tip whose switch is armed, so both `checkin` and `retract`
/// are live entry points. `nonce` starts at 0, so the first action the tipster signs is nonce 1.
async fn tip_with_switch(env: &Env) -> (u64, u64) {
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
    (programme_id, tip_id)
}

#[tokio::test]
async fn a_signed_checkin_and_retract_are_accepted() {
    // The positive control for every test below: the same helper that produces the bad signatures
    // produces a good one here, so a failure of the tests after this one means a rule bit, not a
    // broken fixture.
    let env = Env::setup().await;
    let (_, tip_id) = tip_with_switch(&env).await;

    env.signed_call(&env.relayer_1, "checkin", tip_id, 1, Action::Checkin)
        .await
        .expect("a tipster-signed check-in forwarded by a relayer should be accepted");
    assert_eq!(env.tip_status(tip_id).await, "Submitted");

    env.signed_call(&env.relayer_2, "retract", tip_id, 2, Action::Retract)
        .await
        .expect("either relayer may forward the same action — the tipster does not choose them");
    assert_eq!(env.tip_status(tip_id).await, "Retracted");
}

#[tokio::test]
async fn wrong_key_fails() {
    let env = Env::setup().await;
    let (programme_id, tip_id) = tip_with_switch(&env).await;

    let error = env
        .signed_call_with(
            &env.relayer_1,
            "retract",
            tip_id,
            1,
            &env.signed_action_wrong_key(tip_id, 1, Action::Retract),
        )
        .await
        .expect_err("a signature from anyone else's key must not withdraw someone's tip");
    assert!(error.contains("E09_BAD_SIGNATURE"), "got: {error}");
    // Nothing moved: not the status, not the nonce, not the money.
    assert_eq!(env.tip_status(tip_id).await, "Submitted");
    assert_eq!(
        env.tip_view(tip_id).await["nonce"]
            .as_u64()
            .expect("nonce is a plain u64 in JSON"),
        0,
        "a refused action must not consume the nonce"
    );
    assert_eq!(env.programme_money(programme_id).await.1, 0);
}

#[tokio::test]
async fn a_signature_made_for_another_deployment_fails() {
    // The tipster signs the contract account into the message (`SignedAction::contract`), so a
    // captured action cannot be replayed against a copy of the contract deployed under a different
    // name — including a malicious front-end that would accept the same bytes.
    let env = Env::setup().await;
    let (_, tip_id) = tip_with_switch(&env).await;

    let impostor_contract = env.root.id().clone();
    assert_ne!(impostor_contract, *env.sealedtip.id());
    let signature = env.signed_action_on(&impostor_contract, tip_id, 1, Action::Retract);
    let error = env
        .signed_call_with(&env.relayer_1, "retract", tip_id, 1, &signature)
        .await
        .expect_err("the same bytes signed for a different contract are not an authorisation here");
    assert!(
        error.contains("E09_BAD_SIGNATURE"),
        "a signature is only good for the deployment named in it, got: {error}"
    );
    assert_eq!(env.tip_status(tip_id).await, "Submitted");
}

#[tokio::test]
async fn changed_payout_fails() {
    // `claim` rebuilds the signed bytes from the `payout` the caller presents, so the destination and
    // the rail are both inside the signature. Swapping only the *rail* is the case a guard on
    // tip id, nonce and account would wave through: same implicit address the tipster signed for, but
    // `Payout::Intents` — a 1Click deposit address with a memo — instead of the NEAR transfer they
    // asked for. The redirect case (a different account) is in `tests/claims.rs`; this is the half
    // that only the signed payload can catch.
    let env = Env::setup().await;
    let (programme_id, tip_id) = env.accepted_tip(200).await;
    let destination = implicit_id("payout.swap.destination");
    let signed_for = Payout::Near {
        account: destination.clone(),
    };
    let swapped = Payout::Intents {
        deposit_address: destination.clone(),
        memo: Some("q-1234".to_string()),
    };

    let signature = env.signed_action(
        tip_id,
        1,
        Action::Claim {
            payout: signed_for.clone(),
        },
    );
    let claim = env
        .claim_with(&env.relayer_1, tip_id, &swapped, 1, &signature)
        .await;
    assert!(
        claim.said("E09_BAD_SIGNATURE"),
        "a claim signed for a NEAR payout was paid as an Intents one: {}",
        claim.report()
    );
    assert_eq!(env.tip_status(tip_id).await, "Accepted");
    assert_eq!(
        (
            env.programme_money(programme_id).await,
            env.ops_balance(programme_id).await,
        ),
        ((1_000 * common::UNIT, 200 * common::UNIT), OPS,),
        "a refusal at the signature must not spend the escrow or the programme's NEAR"
    );
    assert_eq!(env.tusdc_balance(&destination).await, 0);

    // The positive control: those same bytes are a valid authorisation for the payout they name, so
    // E09 above was the rail and not a broken fixture.
    env.claim(&env.relayer_1, tip_id, &signed_for, 1)
        .await
        .expect_paid();
    assert_eq!(env.tusdc_balance(&destination).await, 200 * common::UNIT);
}

#[tokio::test]
async fn replayed_nonce_fails() {
    let env = Env::setup().await;
    let (_, tip_id) = tip_with_switch(&env).await;

    let signature = env.signed_action(tip_id, 1, Action::Checkin);
    env.signed_call_with(&env.relayer_1, "checkin", tip_id, 1, &signature)
        .await
        .expect("the first check-in is honest");
    let after_first = env.tip_public(tip_id).await["switch_deadline"].clone();
    assert_ne!(
        after_first,
        serde_json::Value::Null,
        "the check-in should have moved the deadline"
    );

    // A relayer that double-sends the same receipt — the ordinary failure this guard is for — gets
    // the same bytes back rejected, so the switch cannot be wound forward twice on one proof of life.
    let error = env
        .signed_call_with(&env.relayer_1, "checkin", tip_id, 1, &signature)
        .await
        .expect_err("a spent nonce cannot buy another deadline");
    assert!(error.contains("E10_BAD_NONCE"), "got: {error}");
    assert_eq!(
        env.tip_public(tip_id).await["switch_deadline"],
        after_first,
        "the refused replay left the deadline where the accepted check-in put it"
    );
}

#[tokio::test]
async fn a_nonce_two_ahead_is_refused() {
    // The rule is "the next nonce", not "a later nonce": a tipster cannot pre-authorise a batch of
    // actions and let a relayer spend them in any order it likes.
    let env = Env::setup().await;
    let (_, tip_id) = tip_with_switch(&env).await;

    let before = env.tip_public(tip_id).await["switch_deadline"].clone();
    let error = env
        .signed_call(&env.relayer_1, "checkin", tip_id, 3, Action::Checkin)
        .await
        .expect_err("skipping a nonce is not an order of business");
    assert!(error.contains("E10_BAD_NONCE"), "got: {error}");
    assert_eq!(
        env.tip_public(tip_id).await["switch_deadline"],
        before,
        "and the deadline the armed tip was given is still the one on record"
    );
}

#[tokio::test]
async fn retract_after_decision_fails() {
    // Once the DAO has voted, the answer belongs to the programme, not the tipster. A retract here
    // would turn `Accepted { reward }` into `Retracted` and strand the reservation the reward is
    // still backed by.
    let env = Env::setup().await;
    let (programme_id, tip_id) = tip_with_switch(&env).await;
    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("a panel member should be able to triage");
    env.call(
        &env.panel_dao,
        "resolve_tip",
        json!({ "tip_id": tip_id, "accept": true, "reward": null }),
    )
    .await
    .expect("the DAO should be able to accept");
    let reserved = env.programme_money(programme_id).await.1;

    let error = env
        .signed_call(&env.relayer_1, "retract", tip_id, 1, Action::Retract)
        .await
        .expect_err("a decided tip is not the tipster's to withdraw");
    assert!(error.contains("E14_INVALID_STATUS"), "got: {error}");
    assert_eq!(env.tip_status(tip_id).await, "Accepted");
    assert_eq!(
        env.programme_money(programme_id).await.1,
        reserved,
        "a refused retract must not release the money behind the reward"
    );
}

#[tokio::test]
async fn a_non_relayer_cannot_forward_an_action() {
    // The signature proves the tipster's intent; the relayer allow-list proves the call reached the
    // contract through a party the owner vouched for. A panel member holding a valid signature still
    // has no right to be the one that spends it — the role guard runs first, so this never even
    // reaches `ed25519_verify`.
    let env = Env::setup().await;
    let (_, tip_id) = tip_with_switch(&env).await;
    let signature = env.signed_action(tip_id, 1, Action::Retract);

    let error = env
        .signed_call_with(&env.member_1, "retract", tip_id, 1, &signature)
        .await
        .expect_err("a panel member is not a relayer");
    assert!(error.contains("E04_NOT_RELAYER"), "got: {error}");

    // And the same signature is still unspent: the refusal consumed nothing, so the tipster can have
    // it forwarded by someone who is allowed to.
    env.signed_call_with(&env.relayer_1, "retract", tip_id, 1, &signature)
        .await
        .expect("a signature refused for the wrong caller is still the tipster's own");
    assert_eq!(env.tip_status(tip_id).await, "Retracted");
}

#[tokio::test]
async fn an_action_on_a_tip_that_does_not_exist_is_refused() {
    let env = Env::setup().await;
    let _ = env.funded_programme(500, 1_000).await;
    let tip_id = Env::MISSING_TIP;

    let error = env
        .signed_call(&env.relayer_1, "retract", tip_id, 1, Action::Retract)
        .await
        .expect_err("there is no tip 4242 here");
    assert!(error.contains("E02_TIP_NOT_FOUND"), "got: {error}");
}
