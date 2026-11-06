//! The dead man's switch over RPC: who may wind it, who may fire it, and what firing it lets the
//! keeper do. ROADMAP S-5.6.
//!
//! These run in demo mode (`time_scale` = 1440), where a day of tipster time is a minute of chain
//! time. That is not a shortcut around the rule — the compression is the rule (S-2.3), and the
//! contract applies the same scale to the grace that it applies to the interval, so the ratio the
//! tipster chose survives into the compressed clock. What it buys is a test that waits 70 seconds of
//! chain time rather than 90,000 blocks.
mod common;

use common::{Env, Submission};
use sealedtip::types::Action;
use serde_json::json;

const HOUR_NS: u64 = 3_600_000_000_000;
const DAY_NS: u64 = 24 * HOUR_NS;
/// Demo mode: the 24 h interval becomes a minute and the 4 h grace becomes ten seconds.
const DEMO_INTERVAL_NS: u64 = 60_000_000_000;
const DEMO_GRACE_NS: u64 = 10_000_000_000;
/// Past the deadline and past the grace, with a block or two to spare.
const DEMO_DUE_NS: u64 = DEMO_INTERVAL_NS + DEMO_GRACE_NS + 2_000_000_000;

/// A funded programme at scale 1440, so every duration in it is compressed.
async fn demo(env: &Env) -> u64 {
    env.funded_programme_scaled(500, 1_000, 1440).await
}

/// A tip with the switch armed: the tipster is alive, silent, and protected by both clocks.
async fn armed(env: &Env, programme_id: u64) -> u64 {
    armed_with(env, programme_id, (DAY_NS, 4 * HOUR_NS)).await
}

/// As above, with the interval and grace the tipster chose (in *real* nanoseconds — the programme's
/// `time_scale` compresses both).
async fn armed_with(env: &Env, programme_id: u64, switch: (u64, u64)) -> u64 {
    env.submit(
        &env.relayer_1,
        Submission {
            switch: Some(switch),
            ..Submission::new(programme_id, &env.member_1, &env.member_2)
        },
    )
    .await
    .expect("an honest submission with an armed switch")
}

/// A `U64` nanoseconds field off `get_tip_public`, read as a number so tests can compare clocks.
async fn ns(env: &Env, tip_id: u64, field: &str) -> u64 {
    let value = env.tip_public(tip_id).await[field].clone();
    let text = value
        .as_str()
        .unwrap_or_else(|| panic!("{field} is not a decimal string: {value}"));
    text.parse()
        .unwrap_or_else(|e| panic!("{field} is not a number: {e}"))
}

#[tokio::test]
async fn trigger_before_deadline_plus_grace_fails() {
    let env = Env::setup().await;
    let programme_id = demo(&env).await;
    // A short interval and a long grace, so the two windows are wider than the block-time slack
    // `advance` leaves and each assertion says which of them the call fell in.
    let tip_id = armed_with(&env, programme_id, (HOUR_NS, DAY_NS)).await;

    // The arming itself is what the tipster asked for, compressed by the programme's scale: an hour
    // becomes two-and-a-half seconds, a day becomes a minute.
    let submitted_at = ns(&env, tip_id, "submitted_at").await;
    let deadline = ns(&env, tip_id, "switch_deadline").await;
    assert_eq!(
        deadline - submitted_at,
        HOUR_NS / 1440,
        "the deadline is the interval the tipster chose, scaled"
    );
    let due = deadline + DAY_NS / 1440;

    // Nobody may fire it while the tipster is still inside their own deadline.
    for caller in [&env.root, &env.member_1, &env.keeper, &env.funder] {
        let error = env
            .call(caller, "trigger", json!({ "tip_id": tip_id }))
            .await
            .expect_err("the switch is not open yet");
        assert!(
            error.contains("E18_SWITCH_NOT_DUE"),
            "{} could trigger an unexpired switch: {error}",
            caller.id()
        );
    }

    // Past the deadline but inside the grace: the tipster who is alive and merely slow still has
    // this window, and it is the one the compression must not eat.
    env.advance(DEMO_GRACE_NS / 2).await;
    assert!(
        env.now_ns().await > deadline,
        "the interval should have expired by now"
    );
    assert!(
        env.now_ns().await < due,
        "the test jumped past the grace; it can only prove the rule inside it"
    );
    let error = env
        .call(&env.root, "trigger", json!({ "tip_id": tip_id }))
        .await
        .expect_err("the grace belongs to the tipster");
    assert!(error.contains("E18_SWITCH_NOT_DUE"), "got: {error}");
    assert!(!env.switch_triggered(tip_id).await);
}

#[tokio::test]
async fn checkin_extends_deadline() {
    let env = Env::setup().await;
    let programme_id = demo(&env).await;
    let tip_id = armed(&env, programme_id).await;
    let armed_deadline = ns(&env, tip_id, "switch_deadline").await;

    // Half a minute of silence, then a check-in: the clock restarts from the check-in rather than
    // adding to what was left, which is the difference between a switch and a countdown.
    env.advance(DEMO_INTERVAL_NS / 2).await;
    let before = env.now_ns().await;
    env.signed_call(&env.relayer_1, "checkin", tip_id, 1, Action::Checkin)
        .await
        .expect("a live tipster's check-in");
    let extended = ns(&env, tip_id, "switch_deadline").await;

    assert!(
        extended > armed_deadline,
        "the check-in moved the deadline backwards: {extended} <= {armed_deadline}"
    );
    assert!(
        extended >= before + DEMO_INTERVAL_NS,
        "the deadline was not measured from the check-in ({extended} vs block {before})"
    );
    assert!(
        extended <= env.now_ns().await + DEMO_INTERVAL_NS,
        "the deadline ran ahead of the block it was set in"
    );
    assert!(!env.switch_triggered(tip_id).await);

    // And the extended deadline is real: the moment that would have fired the old one now does not.
    env.advance(DEMO_INTERVAL_NS - DEMO_INTERVAL_NS / 2 + DEMO_GRACE_NS / 2)
        .await;
    let error = env
        .call(&env.root, "trigger", json!({ "tip_id": tip_id }))
        .await
        .expect_err("a check-in that buys a new deadline must buy the whole one");
    assert!(error.contains("E18_SWITCH_NOT_DUE"), "got: {error}");
}

#[tokio::test]
async fn a_silent_tipster_is_released_by_anybody_once_the_grace_has_passed() {
    // The switch is the tipster's protection against everyone, so the party allowed to run it
    // cannot be an allow-list the tipster might not be in. Once the deadline and grace have passed,
    // the only thing `trigger` records is that they have.
    let env = Env::setup().await;
    let programme_id = demo(&env).await;
    let tip_id = armed(&env, programme_id).await;
    env.advance(DEMO_DUE_NS).await;

    env.call(&env.root, "trigger", json!({ "tip_id": tip_id }))
        .await
        .expect("an account with no role at all should be able to fire a due switch");
    assert!(env.switch_triggered(tip_id).await);
    assert_eq!(env.tip_status(tip_id).await, "Submitted");

    // Once fired it stays fired: a second trigger would double-count the release for any watcher
    // that reads the events.
    let error = env
        .call(&env.root, "trigger", json!({ "tip_id": tip_id }))
        .await
        .expect_err("one trigger is one release");
    assert!(error.contains("E14_INVALID_STATUS"), "got: {error}");

    // A check-in cannot undo it either — by now the keeper may hold the bundle key.
    let error = env
        .signed_call(&env.relayer_1, "checkin", tip_id, 1, Action::Checkin)
        .await
        .expect_err("the tipster coming back late does not un-release the bundle");
    assert!(error.contains("E14_INVALID_STATUS"), "got: {error}");
}

#[tokio::test]
async fn only_keeper_posts_released_keys() {
    let env = Env::setup().await;
    let programme_id = demo(&env).await;
    let tip_id = armed(&env, programme_id).await;

    // Before the switch has fired there is nothing to release, and that refusal is E20 rather than
    // E07 — the state guard, not the role guard.
    let error = env
        .post_keys(&env.keeper, tip_id, &[&env.member_1])
        .await
        .expect_err("the keeper cannot release early");
    assert!(error.contains("E20_NOT_TRIGGERED"), "got: {error}");

    env.advance(DEMO_DUE_NS).await;
    env.call(&env.root, "trigger", json!({ "tip_id": tip_id }))
        .await
        .expect("the switch is due");

    // The keeper is the only party that ever held the bundle key, so it is the only one that can
    // post a re-sealing of it. Everyone else — including the owner who appointed it and the panel
    // whose members the keys are for — is refused.
    for caller in [
        &env.root,
        &env.owner,
        &env.funder,
        &env.panel_dao,
        &env.member_1,
        &env.relayer_1,
    ] {
        let error = env
            .post_keys(caller, tip_id, &[&env.member_1, &env.member_2])
            .await
            .expect_err("not the keeper");
        assert!(
            error.contains("E07_NOT_KEEPER"),
            "{} posted released keys: {error}",
            caller.id()
        );
    }
    assert!(
        env.tip_view(tip_id).await["released_keys"]
            .as_array()
            .is_some_and(Vec::is_empty),
        "a refused post must leave the tip with no keys"
    );

    env.post_keys(&env.keeper, tip_id, &[&env.member_1, &env.member_2])
        .await
        .expect("the keeper is the one account that should be able to do this");
    let keys = env.tip_view(tip_id).await["released_keys"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(keys.len(), 2, "got: {keys:?}");
}

#[tokio::test]
async fn released_keys_exclude_recused_members() {
    // `get_tip_for_panel` hands these CIDs to whoever proves a panel seat, so a released key naming
    // a recused reviewer would put the bundle key in front of exactly the person the tipster
    // excluded. The contract checks it rather than trusting the keeper — including when the keeper
    // is the one being subverted.
    let env = Env::setup().await;
    let programme_id = demo(&env).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission {
                sealed: vec![env.member_1.id().clone(), env.member_3.id().clone()],
                recused: vec![env.member_2.id().clone()],
                switch: Some((DAY_NS, 4 * HOUR_NS)),
                ..Submission::new(programme_id, &env.member_1, &env.member_3)
            },
        )
        .await
        .expect("a submission that recuses a panel member");
    env.advance(DEMO_DUE_NS).await;
    env.call(&env.root, "trigger", json!({ "tip_id": tip_id }))
        .await
        .expect("the switch is due");

    let error = env
        .post_keys(
            &env.keeper,
            tip_id,
            &[&env.member_1, &env.member_2, &env.member_3],
        )
        .await
        .expect_err("member_2 was recused");
    assert!(
        error.contains("E13_SEALED_TO_RECUSED"),
        "a release naming a recused member got: {error}"
    );

    // One name in the list is enough to refuse the whole post, so the honest set is a second call —
    // and it is the set the tipster actually sealed to.
    env.post_keys(&env.keeper, tip_id, &[&env.member_1, &env.member_3])
        .await
        .expect("the non-recused members can still be served");
    let released = env.tip_view(tip_id).await["released_keys"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(released.len(), 2, "got: {released:?}");
    assert!(
        !released
            .iter()
            .any(|key| key["member"] == json!(env.member_2.id().to_string())),
        "the recused member appeared in the release: {released:?}"
    );
}

#[tokio::test]
async fn heartbeat_updates_last_seen() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;

    // Fresh: nothing has been claimed about the keeper's liveness.
    assert_eq!(env.keeper_last_seen(programme_id).await, 0);

    let error = env.call(&env.owner, "heartbeat", json!({})).await;
    assert!(
        error.is_err(),
        "the owner who appointed the keeper must not be able to sign for it"
    );

    let before = env.now_ns().await;
    env.call(&env.keeper, "heartbeat", json!({}))
        .await
        .expect("the keeper can report its own liveness");
    let seen = env.keeper_last_seen(programme_id).await;
    assert!(
        seen > before,
        "the heartbeat recorded {seen}, at or before the block {before} it was sent in"
    );
    assert!(
        seen <= env.now_ns().await,
        "the heartbeat recorded a future block: {seen}"
    );

    // Recording liveness is the only thing a heartbeat is allowed to do. It cannot make the switch
    // look dead, move a deadline, or touch the money.
    assert_eq!(
        env.programme_money(programme_id).await,
        (1_000 * common::UNIT, 0)
    );
}

#[tokio::test]
async fn rotating_the_keeper_zeroes_the_liveness_it_inherited() {
    // S-2.9 documented this; it is checked here because a stale `keeper_last_seen` is the failure
    // mode a panel reads as "the release service is fine" while nobody is running it.
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;
    env.call(&env.keeper, "heartbeat", json!({}))
        .await
        .expect("the keeper reports in");
    assert!(env.keeper_last_seen(programme_id).await > 0);

    let next = env
        .root
        .create_subaccount("keeper2")
        .initial_balance(near_workspaces::types::NearToken::from_near(5))
        .transact()
        .await
        .expect("create keeper2")
        .into_result()
        .expect("keeper2 reverted");
    env.call(
        &env.owner,
        "set_keeper",
        json!({
            "keeper": next.id(),
            "keeper_x25519_pub": vec![7u8; 32],
        }),
    )
    .await
    .expect("the owner rotates the keeper");
    assert_eq!(
        env.keeper_last_seen(programme_id).await,
        0,
        "a new keeper has not proven it is running yet"
    );

    let error = env
        .call(&env.keeper, "heartbeat", json!({}))
        .await
        .expect_err("the retired keeper lost the right to report liveness");
    assert!(error.contains("E07_NOT_KEEPER"), "got: {error}");

    env.call(&next, "heartbeat", json!({}))
        .await
        .expect("the new keeper proves itself by its own heartbeat");
    assert!(env.keeper_last_seen(programme_id).await > 0);
}
