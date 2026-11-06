//! Integration tests — ROADMAP S-5.7: the powers the contract does not hand out.
//!
//! The other suites check each role from the inside, one method at a time. This one checks the
//! boundary of the role that is supposed to hold no money at all. The owner is the account that can
//! stall the system — it picks the relayers and the keeper — so the rule (ARCHITECTURE §5, S-2.9) is
//! that it can do those two things and nothing else.
//!
//! This needs a sandbox rather than a unit test because every entry point below is *open*: anyone can
//! send a transaction naming `withdraw_unreserved`, `ft_on_transfer` or `resolve_tip`, and the only
//! thing between the owner and a programme's money is a check inside the deployed wasm. A unit test
//! of `access.rs` proves the helper panics; it cannot prove that the method a caller actually reaches
//! is built on top of the helper.
mod common;

use near_workspaces::Account;
use sealedtip::types::{Action, Payout};
use serde_json::json;

use common::{fund_msg, Env, Submission, KEEPER_X25519, UNIT};

const HOUR_NS: u64 = 3_600_000_000_000;
const DAY_NS: u64 = 24 * HOUR_NS;
/// The per-tip ceiling the programme in the first test is opened with, in tUSDC — the amount a
/// credible triage reserves, which is the one number in the escrow this test expects to move.
const MAX_REWARD_UNITS: u128 = 500;

/// Call `method` as `who` and assert the contract refused it with `code` rather than letting it run.
async fn refused(env: &Env, who: &Account, method: &str, args: serde_json::Value, code: &str) {
    match env.call(who, method, args).await {
        Ok(()) => panic!("{} was allowed to call {method}", who.id()),
        Err(error) => assert!(
            error.contains(code),
            "{method} was refused, but not by {code}: {error}"
        ),
    }
}

/// The same for the calls that need more than a method name, because their arguments are built by a
/// harness route rather than written out here.
fn assert_refused(result: Result<(), String>, method: &str, code: &str) {
    match result {
        Ok(()) => panic!("{method} ran for a caller it should have refused"),
        Err(error) => assert!(
            error.contains(code),
            "{method} was refused, but not by {code}: {error}"
        ),
    }
}

#[tokio::test]
async fn owner_cannot_touch_funds_or_tips() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(MAX_REWARD_UNITS, 1_000).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .expect("a relayer should be able to store an honest submission");

    // The books at the start, so that the assertions at the end are about the thirteen calls below
    // and not about whatever the setup helpers happened to write.
    let money = env.programme_money(programme_id).await;
    let funder_wallet = env.tusdc_balance(env.funder.id()).await;
    let panel_size = env.programme_view(programme_id).await["panel"]
        .as_array()
        .expect("panel is an array")
        .len();

    // --- the money ---------------------------------------------------------------------------
    refused(
        &env,
        &env.owner,
        "withdraw_unreserved",
        json!({ "programme_id": programme_id, "amount": (100 * UNIT).to_string() }),
        "E03_NOT_FUNDER",
    )
    .await;
    refused(
        &env,
        &env.owner,
        "close_programme",
        json!({ "programme_id": programme_id }),
        "E03_NOT_FUNDER",
    )
    .await;

    // The attempt here that needs nobody else's key and moves no token: `ft_on_transfer` is a NEP-141
    // receiver, so every account on the chain can name it, and if it credited whoever called it, the
    // owner could inflate a programme's balance out of nothing and then withdraw the difference as
    // `withdraw_unreserved`. The only thing standing in the way is the check that the caller is this
    // programme's own token.
    refused(
        &env,
        &env.owner,
        "ft_on_transfer",
        json!({
            "sender_id": env.funder.id(),
            "amount": (1_000 * UNIT).to_string(),
            "msg": fund_msg(programme_id),
        }),
        "E21_WRONG_TOKEN",
    )
    .await;

    // --- the tips ----------------------------------------------------------------------------
    refused(
        &env,
        &env.owner,
        "set_panel",
        json!({
            "programme_id": programme_id,
            "members": [
                { "account": env.owner.id(), "x25519_pub": vec![7u8; 32] },
                { "account": env.member_3.id(), "x25519_pub": vec![8u8; 32] },
            ],
        }),
        "E05_NOT_PANEL_DAO",
    )
    .await;
    refused(
        &env,
        &env.owner,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
        "E06_NOT_PANEL_MEMBER",
    )
    .await;

    // A seated member does the triage now, so the next line tests who may *resolve* rather than
    // tripping the status rule that would fire first on a `Submitted` tip.
    env.call(
        &env.member_1,
        "triage",
        json!({ "tip_id": tip_id, "credible": true }),
    )
    .await
    .expect("a seated panel member should be able to triage");
    assert_eq!(env.tip_status(tip_id).await, "UnderReview");

    refused(
        &env,
        &env.owner,
        "resolve_tip",
        json!({ "tip_id": tip_id, "accept": true, "reward": null }),
        "E05_NOT_PANEL_DAO",
    )
    .await;

    // --- the tipster's routes, which only a relayer may forward ------------------------------
    let payout = Payout::Near {
        account: env.member_2.id().clone(),
    };
    let claim = env.claim(&env.owner, tip_id, &payout, 1).await;
    assert!(
        !claim.succeeded(),
        "the owner claimed and paid a tip: {}",
        claim.report()
    );
    assert!(
        claim.said("E04_NOT_RELAYER"),
        "the owner's claim failed for something other than the relayer check: {}",
        claim.report()
    );
    assert_refused(
        env.signed_call(&env.owner, "retract", tip_id, 1, Action::Retract)
            .await,
        "retract",
        "E04_NOT_RELAYER",
    );
    assert_refused(
        env.signed_call(&env.owner, "checkin", tip_id, 1, Action::Checkin)
            .await,
        "checkin",
        "E04_NOT_RELAYER",
    );
    assert_refused(
        env.submit(
            &env.owner,
            Submission::new(programme_id, &env.member_1, &env.member_2),
        )
        .await
        .map(|_| ()),
        "submit_tip",
        "E04_NOT_RELAYER",
    );

    // --- the keeper's -----------------------------------------------------------------------
    refused(&env, &env.owner, "heartbeat", json!({}), "E07_NOT_KEEPER").await;
    assert_refused(
        env.post_keys(&env.owner, tip_id, &[&env.member_1, &env.member_2])
            .await,
        "post_released_keys",
        "E07_NOT_KEEPER",
    );

    // --- the switch ---------------------------------------------------------------------------
    // `trigger` has no role guard on purpose: the switch protects the tipster from everyone, so the
    // account allowed to fire it cannot be an allow-list they might all be in. That makes it the one
    // method here the owner *can* reach, which is why it belongs in this suite — what stops the owner
    // from releasing a tipster's keys early is the deadline rather than a caller check, and the
    // deadline holds anyway.
    let armed = env
        .submit(
            &env.relayer_1,
            Submission {
                switch: Some((HOUR_NS, DAY_NS)),
                ..Submission::new(programme_id, &env.member_1, &env.member_2)
            },
        )
        .await
        .expect("a relayer should be able to store a submission with the switch armed");
    assert!(
        !env.switch_triggered(armed).await,
        "an armed switch starts untriggered"
    );
    refused(
        &env,
        &env.owner,
        "trigger",
        json!({ "tip_id": armed }),
        "E18_SWITCH_NOT_DUE",
    )
    .await;

    // --- the positive control -----------------------------------------------------------------
    // The two calls the owner really does hold, made against the accounts it already names, so they
    // prove this harness's `owner` is the contract's owner and every refusal above is about the
    // method rather than about the account.
    env.call(
        &env.owner,
        "set_relayers",
        json!({ "relayers": [env.relayer_1.id(), env.relayer_2.id()] }),
    )
    .await
    .expect("the owner should be able to rotate relayers");
    env.call(
        &env.owner,
        "set_keeper",
        json!({ "keeper": env.keeper.id(), "keeper_x25519_pub": KEEPER_X25519.to_vec() }),
    )
    .await
    .expect("the owner should be able to rotate the keeper");

    // --- nothing moved ------------------------------------------------------------------------
    // The reservation is the one number here that is *supposed* to have moved, and it moved because a
    // seated member triaged the tip credibly, not because of anything the owner attempted.
    assert_eq!(
        env.programme_money(programme_id).await,
        (money.0, money.1 + MAX_REWARD_UNITS * UNIT),
        "the escrow's balance moved, or its reservation moved by anything other than the member's \
         own credible triage"
    );
    assert_eq!(
        funder_wallet,
        env.tusdc_balance(env.funder.id()).await,
        "a refused call paid the funder"
    );
    assert_eq!(
        "UnderReview",
        env.tip_status(tip_id).await,
        "a refused call decided the tip"
    );
    assert_eq!(
        panel_size,
        env.programme_view(programme_id).await["panel"]
            .as_array()
            .expect("panel is an array")
            .len(),
        "the owner seated reviewers it does not control"
    );
    assert_eq!(
        json!(true),
        env.programme_view(programme_id).await["open"],
        "the owner closed a programme"
    );
    assert_eq!(
        json!([]),
        env.tip_view(tip_id).await["released_keys"],
        "the owner released bundle keys"
    );
    assert!(
        !env.switch_triggered(armed).await,
        "the owner fired a switch before its deadline"
    );
    assert_eq!(
        0,
        env.keeper_last_seen(programme_id).await,
        "the owner sent a heartbeat"
    );
}

/// What the deployed contract has stored as this programme's `time_scale`.
async fn stored_scale(env: &Env, programme_id: u64) -> u32 {
    let scale = env.programme_view(programme_id).await["time_scale"].clone();
    scale.as_u64().unwrap_or_else(|| {
        panic!("time_scale is not a number for programme {programme_id}: {scale}")
    }) as u32
}

#[tokio::test]
async fn time_scale_cannot_change() {
    let env = Env::setup().await;
    // Two programmes at two scales. One programme would pass a bug that overwrites the field with a
    // constant, and a scale stored once for the whole contract would pass a bug that lets a later
    // funder retune the deadlines of tips already waiting on an earlier one.
    let slow = env.funded_programme_scaled(500, 1_000, 1).await;
    let fast = env.funded_programme_scaled(500, 1_000, 1440).await;
    assert_eq!(stored_scale(&env, slow).await, 1);
    assert_eq!(stored_scale(&env, fast).await, 1440);

    // There is no setter for any role to find — not for the funder that opened the programme, not for
    // the owner that can rotate everything else.
    for (method, who) in [
        ("set_time_scale", &env.funder),
        ("update_programme", &env.funder),
        ("set_time_scale", &env.owner),
    ] {
        let attempted = env
            .call(
                who,
                method,
                json!({ "programme_id": slow, "time_scale": 1440 }),
            )
            .await;
        assert!(
            attempted.is_err(),
            "{method} exists, and {who:?} used it to retune a live programme: {attempted:?}"
        );
    }

    // And the methods that do exist cannot reach the field while they are about their own business.
    env.withdraw_check(slow, 100)
        .await
        .expect("the funder can take back what no tip is reserved against");
    env.call(
        &env.panel_dao,
        "set_panel",
        json!({
            "programme_id": slow,
            "members": [
                { "account": env.member_1.id(), "x25519_pub": vec![1u8; 32] },
                { "account": env.member_2.id(), "x25519_pub": vec![2u8; 32] },
            ],
        }),
    )
    .await
    .expect("the DAO can re-seat its panel");
    env.call(
        &env.funder,
        "close_programme",
        json!({ "programme_id": slow }),
    )
    .await
    .expect("the funder can close its own programme");

    // A funder opening a second programme gets a new row, not a retune of the first.
    let third = env.open_programme(500, 0, 1440).await;
    assert_ne!(slow, third, "a second `create_programme` reused an id");

    assert_eq!(
        1,
        stored_scale(&env, slow).await,
        "a call that is not `create_programme` changed a programme's `time_scale`"
    );
    assert_eq!(
        1440,
        stored_scale(&env, fast).await,
        "another programme's scale moved while the first was being poked at"
    );
    assert_eq!(
        1440,
        stored_scale(&env, third).await,
        "the programme just opened did not take the scale it was created with"
    );

    // Scale 0 is the value that would collapse every deadline: `time::scaled` divides by it, so a
    // programme stored at 0 turns "24 hours" into "the block it is read in". It is refused where the
    // field can actually be written, which is the one and only time it is ever set.
    let zero = env
        .try_open_programme(500, 0, 0)
        .await
        .expect_err("a programme created at time_scale 0 would divide every deadline by zero");
    assert!(
        zero.contains("E25_INVALID_TIME_SCALE"),
        "scale 0 was refused for something else: {zero}"
    );
}
