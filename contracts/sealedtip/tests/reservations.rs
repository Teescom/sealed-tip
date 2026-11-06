//! S-5.1 over RPC: invariant 1 — money is committed only by a panel member's judgement, and only
//! the judgement that ends a tip's life gives it back.
//!
//! The arithmetic is the unit tests' job (`src/programme.rs`). What only a real token can prove is
//! the boundary between `reserved` and the funder's withdrawable balance: that a reservation is
//! counted by `withdraw_unreserved` when it reaches for the actual tUSDC, and that releasing one
//! makes the money move again rather than just changing a number in our storage.
mod common;

use common::{Env, Submission, UNIT};
use serde_json::json;

/// The two numbers that describe an escrow, in base units.
async fn money(env: &Env, programme_id: u64) -> (u128, u128) {
    env.programme_money(programme_id).await
}

#[tokio::test]
async fn submission_reserves_nothing() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;

    // Ten submissions is the spam case the PoW is supposed to price. None of them may touch the
    // funder's money, because nobody has said any of them is credible yet.
    for _ in 0..10 {
        env.submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("a valid submission");
    }
    assert_eq!(
        money(&env, programme_id).await,
        (1_000 * UNIT, 0),
        "invariant 1: submit_tip must not reserve"
    );
    // And all of it is still the funder's to take back.
    env.withdraw_check(programme_id, 1_000)
        .await
        .expect("10 unpaid submissions must not freeze a single token");
}

#[tokio::test]
async fn credible_triage_reserves_max_reward() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("submission");

    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("a member's credible judgement");
    assert_eq!(
        money(&env, programme_id).await,
        (1_000 * UNIT, 500 * UNIT),
        "the whole ceiling is committed, because the DAO may accept up to it"
    );

    // A second credible tip fits beside the first (1000 - 500 >= 500); the third does not.
    let second = env
        .submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("second submission");
    env.call(
        &env.member_2,
        "triage",
        json!({ "tip_id": second, "credible": true }),
    )
    .await
    .expect("the escrow can back two tips at the ceiling");
    assert_eq!(money(&env, programme_id).await.1, 1_000 * UNIT);

    let third = env
        .submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("third submission");
    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": third, "credible": true }),
    )
    .await
    .expect("believing a tip is not refused for lack of money");
    assert_eq!(
        money(&env, programme_id).await.1,
        1_000 * UNIT,
        "the third tip is believed but unfunded, so it reserves nothing"
    );
    assert_eq!(env.tip_status(third).await, "Unfunded");
}

#[tokio::test]
async fn dismiss_releases_nothing_reserved() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("submission");

    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": false }),
    )
    .await
    .expect("a dismissal is a member's right");
    assert_eq!(
        money(&env, programme_id).await,
        (1_000 * UNIT, 0),
        "nothing was reserved, so a dismissal has nothing to release"
    );
    assert_eq!(env.tip_status(tip_id).await, "Dismissed");
    env.withdraw_check(programme_id, 1_000)
        .await
        .expect("the funder can still take all of it");
    assert_eq!(
        money(&env, programme_id).await,
        (0, 0),
        "dismissing a tip must not spend any of the escrow"
    );
}

#[tokio::test]
async fn withdraw_of_reserved_funds_fails() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("submission");
    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("credible triage reserves 500 of the 1000");

    // The whole balance: 500 of it belongs to a tip the panel already believed.
    let error = env
        .withdraw(programme_id, 1_000)
        .await
        .expect_err("the reserved half is not withdrawable");
    assert!(
        error.contains("E16_RESERVED_FUNDS"),
        "expected the reservation guard, got: {error}"
    );
    // One token over the line, to show the guard is the arithmetic and not a blanket refusal.
    let error = env
        .withdraw(programme_id, 501)
        .await
        .expect_err("501 of 1000 with 500 reserved is 1 over");
    assert!(error.contains("E16_RESERVED_FUNDS"), "got: {error}");
    assert_eq!(
        money(&env, programme_id).await,
        (1_000 * UNIT, 500 * UNIT),
        "two refused withdrawals must not have moved anything"
    );

    // Exactly the unreserved part goes.
    env.withdraw_check(programme_id, 500)
        .await
        .expect("the unreserved half is the funder's");
    assert_eq!(money(&env, programme_id).await, (500 * UNIT, 500 * UNIT));
}

#[tokio::test]
async fn unfunded_tip_reserved_when_programme_funded() {
    let env = Env::setup().await;
    // An empty programme: the panel can still believe a tip, it just cannot pay for one yet.
    let programme_id = env.open_programme(500, 0, 1).await;
    env.seat_panel(programme_id, &[&env.member_1, &env.member_2, &env.member_3])
        .await;
    env.register(env.sealedtip.as_account()).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("submission");
    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("triage on an empty programme is not refused");
    assert_eq!(env.tip_status(tip_id).await, "Unfunded");
    assert_eq!(money(&env, programme_id).await, (0, 0));

    // The funder's money arrives, and the reservation that triage wanted is made. `fund` is the
    // token calling us back, so the check is what the balances end up as.
    env.fund_programme(programme_id, 400).await;
    assert_eq!(
        money(&env, programme_id).await,
        (400 * UNIT, 0),
        "400 cannot back a 500 ceiling, so the tip stays unfunded and the funder keeps it all"
    );
    assert_eq!(env.tip_status(tip_id).await, "Unfunded");

    env.fund_programme(programme_id, 600).await;
    assert_eq!(
        money(&env, programme_id).await,
        (1_000 * UNIT, 500 * UNIT),
        "the second funding is what the judgement is finally held against"
    );
    assert_eq!(
        env.tip_status(tip_id).await,
        "UnderReview",
        "and the tip becomes resolvable without anybody re-voting"
    );
    env.call(
        &env.panel_dao,
        "resolve_tip",
        json!({ "tip_id": tip_id, "accept": true, "reward": null }),
    )
    .await
    .expect("a promoted tip is resolvable");
    assert_eq!(env.accepted_reward(tip_id).await, 500 * UNIT);
}

#[tokio::test]
async fn reject_releases_reservation() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("submission");
    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("credible triage");
    assert_eq!(money(&env, programme_id).await.1, 500 * UNIT);

    env.call(
        &env.panel_dao,
        "resolve_tip",
        json!({ "tip_id": tip_id, "accept": false, "reward": null }),
    )
    .await
    .expect("the DAO rejects it");
    assert_eq!(
        money(&env, programme_id).await,
        (1_000 * UNIT, 0),
        "a rejected tip keeps nothing committed"
    );
    assert_eq!(env.tip_status(tip_id).await, "Rejected");
    env.withdraw_check(programme_id, 1_000)
        .await
        .expect("the funder can take the whole escrow back the moment the tip is dead");
}
