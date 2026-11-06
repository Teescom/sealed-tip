//! S-5.4 over RPC: who may judge a tip, and what a judgement is allowed to do to the money.
//!
//! The state machine itself (`Submitted → UnderReview → Accepted/Rejected`) is walked by the unit
//! tests in `src/tip.rs`. What those cannot check is the caller: on chain, `predecessor_account_id`
//! is the only thing standing between a panel member and a funder's escrow, so each test here names
//! the account that is *not* allowed to make the call and then shows the allowed one can.
mod common;

use common::{Env, Submission};
use serde_json::json;

/// A funded programme with one `Submitted` tip on it: the state every test below begins in.
/// Both ids come back, because the money assertions and the tip assertions are about different rows.
async fn submitted(env: &Env) -> (u64, u64) {
    let programme_id = env.funded_programme(500, 1_000).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("an honest submission should be stored");
    (programme_id, tip_id)
}

#[tokio::test]
async fn recused_member_cannot_triage() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;
    // The tipster sealed to member_1 and member_3 and recused member_2 — so member_2 has no key,
    // has declared a conflict, and must not be the one that decides this tip is credible.
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission {
                sealed: vec![env.member_1.id().clone(), env.member_3.id().clone()],
                recused: vec![env.member_2.id().clone()],
                ..Submission::new(programme_id, &env.member_1, &env.member_3)
            },
        )
        .await
        .expect("a valid submission that recuses a third member");

    let error = env
        .call(
            &env.member_2,
            "triage",
            json!({ "tip_id": tip_id, "credible": true }),
        )
        .await
        .expect_err("a recused member is not a judge");
    assert!(
        error.contains("E06_NOT_PANEL_MEMBER"),
        "expected the recusal guard, got: {error}"
    );
    assert_eq!(env.tip_status(tip_id).await, "Submitted");
    assert_eq!(
        env.programme_money(programme_id).await.1,
        0,
        "a refused triage must not reserve anything"
    );

    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("a non-recused member can triage the same tip");
    assert_eq!(env.tip_status(tip_id).await, "UnderReview");
}

#[tokio::test]
async fn resolve_tip_only_from_panel_dao() {
    let env = Env::setup().await;
    let (programme_id, tip_id) = submitted(&env).await;
    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("triage by a member");

    // The member who judged it credible, the funder who pays for it, the keeper, the owner and the
    // relayer that relayed it: none of them may decide the outcome.
    for caller in [
        &env.member_1,
        &env.member_2,
        &env.funder,
        &env.keeper,
        &env.owner,
        &env.relayer_1,
    ] {
        let error = env
            .call(
                caller,
                "resolve_tip",
                json!({ "tip_id": tip_id, "accept": true, "reward": null }),
            )
            .await
            .expect_err("only the panel DAO resolves");
        assert!(
            error.contains("E05_NOT_PANEL_DAO"),
            "{} reached: {error}",
            caller.id()
        );
    }
    assert_eq!(env.tip_status(tip_id).await, "UnderReview");
    assert_eq!(
        env.programme_money(programme_id).await.1,
        500 * common::UNIT,
        "a refused resolve must leave the reservation exactly where triage put it"
    );

    env.call(
        &env.panel_dao,
        "resolve_tip",
        json!({ "tip_id": tip_id, "accept": true, "reward": null }),
    )
    .await
    .expect("the panel DAO resolves its own programme's tip");
    assert_eq!(env.tip_status(tip_id).await, "Accepted");
}

#[tokio::test]
async fn reward_above_max_fails() {
    let env = Env::setup().await;
    let (programme_id, tip_id) = submitted(&env).await;
    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("triage by a member");

    // 500 tUSDC was the ceiling the funder locked at; the DAO cannot promise more than that, and
    // asking in base units is what a real DAO vote would do.
    let error = env
        .call(
            &env.panel_dao,
            "resolve_tip",
            json!({
                "tip_id": tip_id,
                "accept": true,
                "reward": (501 * common::UNIT).to_string(),
            }),
        )
        .await
        .expect_err("a reward above max_reward is not payable");
    assert!(
        error.contains("E15_REWARD_TOO_HIGH"),
        "expected the ceiling guard, got: {error}"
    );

    // A rejected tip carrying any number at all is refused too: rejection pays nothing, so a reward
    // there is a caller that has mixed up the branches (E31), not a zero to be read and ignored.
    let error = env
        .call(
            &env.panel_dao,
            "resolve_tip",
            json!({
                "tip_id": tip_id,
                "accept": false,
                "reward": "0",
            }),
        )
        .await
        .expect_err("a rejection with a reward attached must be refused");
    assert!(
        error.contains("E31_REWARD_ON_REJECT"),
        "expected the reject-branch guard, got: {error}"
    );

    assert_eq!(
        env.tip_status(tip_id).await,
        "UnderReview",
        "two refused votes leave the tip where the triage put it"
    );
    assert_eq!(
        env.programme_money(programme_id).await.1,
        500 * common::UNIT,
        "and leave the escrow exactly as committed — a refused vote must not free money"
    );

    // The ceiling itself is payable, so E15 above was the ceiling and not a broken comparison.
    env.call(
        &env.panel_dao,
        "resolve_tip",
        json!({
            "tip_id": tip_id,
            "accept": true,
            "reward": (500 * common::UNIT).to_string(),
        }),
    )
    .await
    .expect("exactly max_reward is payable");
    assert_eq!(env.accepted_reward(tip_id).await, 500 * common::UNIT);
}

#[tokio::test]
async fn accept_releases_unused_reservation() {
    let env = Env::setup().await;
    let (programme_id, tip_id) = submitted(&env).await;

    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("triage by a member");
    let (balance, reserved) = env.programme_money(programme_id).await;
    assert_eq!(
        (balance, reserved),
        (1_000 * common::UNIT, 500 * common::UNIT),
        "triage committed the whole ceiling"
    );

    // The DAO accepts at 200. The 300 that will never be paid has to come back to the funder
    // immediately — it is the money the next tip's triage will be judged against.
    env.call(
        &env.panel_dao,
        "resolve_tip",
        json!({
            "tip_id": tip_id,
            "accept": true,
            "reward": (200 * common::UNIT).to_string(),
        }),
    )
    .await
    .expect("accept below the ceiling");
    let (balance, reserved) = env.programme_money(programme_id).await;
    assert_eq!(
        (balance, reserved),
        (1_000 * common::UNIT, 200 * common::UNIT),
        "only what the tip can still claim stays committed"
    );

    // And the released part is withdrawable right now, which is the only proof that "released" means
    // released rather than "reserved by somebody else".
    let before = env.tusdc_balance(env.funder.id()).await;
    env.call(
        &env.funder,
        "withdraw_unreserved",
        json!({
            "programme_id": programme_id,
            "amount": (800 * common::UNIT).to_string(),
        }),
    )
    .await
    .expect("800 of the 1000 is unreserved again");
    assert_eq!(
        env.tusdc_balance(env.funder.id()).await - before,
        800 * common::UNIT
    );
    let (balance, reserved) = env.programme_money(programme_id).await;
    assert_eq!(
        (balance, reserved),
        (200 * common::UNIT, 200 * common::UNIT),
        "the 200 behind the claim is still held"
    );
}
