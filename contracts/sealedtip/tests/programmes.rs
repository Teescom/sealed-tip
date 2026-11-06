//! S-2.6, S-2.8, S-2.10, S-2.11 over RPC: the funder's money path end to end.
//!
//! The unit tests in `src/programme.rs` check the accounting; these check the parts a unit test
//! cannot reach — that the token actually calls us back, that a panic in `ft_on_transfer` makes the
//! token refund the sender, that a refused `ft_transfer` is rolled back by our own callback, and
//! that the JSON argument shapes the frontend will send are the ones the contract accepts.
mod common;

use common::{Env, UNIT};
use near_workspaces::types::{Gas, NearToken};
use serde_json::json;

/// 50 mNEAR in yoctoNEAR, as a decimal string — above `u64::MAX` a JSON number would lose digits.
const DRIP: &str = "5000000000000000000";

/// `{"fund": id}`, the only message this contract accepts.
fn fund_msg(programme_id: u64) -> String {
    format!("{{\"fund\":{programme_id}}}")
}

/// Open a programme as the funder: 1 NEAR attached for `ops_balance`, `max_reward` in tUSDC units.
async fn open(env: &Env, max_reward_units: u128) -> u64 {
    let scope_hash = vec![0x33u8; 32];
    let result = env
        .funder
        .call(env.sealedtip.id(), "create_programme")
        .args_json(json!({
            "title": "Public interest fund",
            "scope_uri": "https://scope.example/rules",
            "scope_hash": scope_hash,
            "panel_dao": env.panel_dao.id(),
            "token": env.token.id(),
            "max_reward": (max_reward_units * UNIT).to_string(),
            "gas_drip": DRIP,
            "pow_bits": 12,
            "time_scale": 1,
        }))
        .deposit(NearToken::from_near(1))
        .transact()
        .await
        .expect("create_programme was not accepted")
        .into_result()
        .expect("create_programme reverted");
    result.json::<u64>().expect("programme id is not a number")
}

/// The funder's tUSDC into the programme, through the token, as the frontend will do it.
/// Nothing is returned: a `ft_on_transfer` panic lands in a later receipt, so the outer transaction
/// succeeds anyway and the only honest check is what the balances end up as.
async fn fund(env: &Env, programme_id: u64, units: u128) {
    // The result is deliberately not unwrapped: a panicking `ft_on_transfer` fails in a later
    // receipt, so the outer outcome stays "success" and only the balances tell the truth.
    let _ = env
        .funder
        .call(env.token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": env.sealedtip.id(),
            "amount": (units * UNIT).to_string(),
            "memo": "programme 0",
            "msg": fund_msg(programme_id),
        }))
        // NEP-141 requires exactly 1 yoctoNEAR on `ft_transfer_call`.
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await
        .expect("ft_transfer_call was not accepted");
}

async fn programme(env: &Env, programme_id: u64) -> serde_json::Value {
    env.sealedtip
        .view("get_programme")
        .args_json(json!({ "programme_id": programme_id }))
        .await
        .expect("get_programme view failed")
        .json::<Option<serde_json::Value>>()
        .expect("get_programme is not JSON")
        .unwrap_or_else(|| panic!("programme {programme_id} is missing"))
}

/// The money the contract holds for this programme, in tUSDC base units.
async fn reserved_and_balance(env: &Env, programme_id: u64) -> (u128, u128) {
    let programme = programme(env, programme_id).await;
    (
        programme["balance"]
            .as_str()
            .unwrap_or_else(|| panic!("balance is not a decimal string: {programme}"))
            .parse()
            .expect("balance is not a number"),
        programme["reserved"]
            .as_str()
            .expect("reserved is not a decimal string")
            .parse()
            .expect("reserved is not a number"),
    )
}

async fn withdraw(env: &Env, programme_id: u64, units: u128) -> Result<(), String> {
    env.funder
        .call(env.sealedtip.id(), "withdraw_unreserved")
        .args_json(json!({
            "programme_id": programme_id,
            "amount": (units * UNIT).to_string(),
        }))
        .gas(Gas::from_tgas(50))
        .transact()
        .await
        .expect("withdraw_unreserved was not accepted")
        .into_result()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Open a programme and fund it with 1,000 tUSDC — the state most tests below start from.
async fn funded(env: &Env) -> u64 {
    let programme_id = open(env, 500).await;
    env.register(env.sealedtip.as_account()).await;
    fund(env, programme_id, 1_000).await;
    programme_id
}

#[tokio::test]
async fn funding_a_programme_moves_tokens_and_credits_the_balance() {
    let env = Env::setup().await;
    let programme_id = open(&env, 500).await;

    // The receiver of a NEP-141 transfer must be registered, or the token refuses it. Registering
    // costs the contract the NEP-145 minimum, which the funder pays for here in the test and the
    // API pays for in production.
    let min = env.register(env.sealedtip.as_account()).await;
    assert!(min.as_yoctonear() > 0);

    assert_eq!(reserved_and_balance(&env, programme_id).await, (0, 0));
    fund(&env, programme_id, 1_000).await;

    assert_eq!(
        reserved_and_balance(&env, programme_id).await,
        (1_000 * UNIT, 0),
        "the programme holds what arrived, and nothing is reserved without a triage"
    );
    assert_eq!(env.tusdc_balance(env.funder.id()).await, 4_000 * UNIT);

    let programme = programme(&env, programme_id).await;
    assert_eq!(programme["open"], json!(true));
    assert_eq!(programme["funder"], json!(env.funder.id().as_str()));
    assert_eq!(programme["time_scale"], json!(1));
    // A funder cannot appoint the panel that judges its own money — the DAO does (S-2.8).
    assert_eq!(programme["panel"].as_array().unwrap().len(), 0);
}

/// E22 end to end: a bad `msg` must not cost the funder its tokens. The panic happens in our
/// receiver, so the *outer* transaction succeeds and only the balances show what really happened.
#[tokio::test]
async fn a_bad_fund_message_leaves_the_sender_whole() {
    let env = Env::setup().await;
    let programme_id = funded(&env).await;

    env.funder
        .call(env.token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": env.sealedtip.id(),
            "amount": (200 * UNIT).to_string(),
            "msg": "{}",
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await
        .expect("ft_transfer_call was not accepted")
        .into_result()
        .expect("the sender's call should not revert; the refund is the token's job");

    assert_eq!(
        reserved_and_balance(&env, programme_id).await,
        (1_000 * UNIT, 0),
        "a refused ft_on_transfer must not credit the programme"
    );
    assert_eq!(
        env.tusdc_balance(env.funder.id()).await,
        4_000 * UNIT,
        "and the 200 tUSDC must be back with the sender"
    );
}

#[tokio::test]
async fn withdrawing_unreserved_tokens_reaches_the_funder() {
    let env = Env::setup().await;
    let programme_id = funded(&env).await;

    withdraw(&env, programme_id, 400)
        .await
        .expect("withdraw_unreserved reverted");

    assert_eq!(
        reserved_and_balance(&env, programme_id).await,
        (600 * UNIT, 0)
    );
    assert_eq!(env.tusdc_balance(env.funder.id()).await, 4_400 * UNIT);
}

/// E16 is the "funder reneges" defence (ARCHITECTURE §11): the moment a panel member has called a
/// tip credible, that money is spoken for, and withdrawing it must be refused outright.
#[tokio::test]
async fn withdrawing_more_than_is_unreserved_is_refused() {
    let env = Env::setup().await;
    let programme_id = funded(&env).await;

    // 1,000 is all the programme holds and none of it is spoken for, so asking for 1,001 crosses
    // the line E16 guards. The reserved half of the same rule is `withdraw_of_reserved_funds_fails`
    // in `tests/reservations.rs`, which needs `triage` (S-3.2) before it can be written for real.
    let err = withdraw(&env, programme_id, 1_001)
        .await
        .expect_err("withdrawing more than the balance should not succeed");
    assert!(err.contains("E16_RESERVED_FUNDS"), "wrong rejection: {err}");
    assert_eq!(
        reserved_and_balance(&env, programme_id).await,
        (1_000 * UNIT, 0),
        "a refused withdrawal moves nothing"
    );
    assert_eq!(env.tusdc_balance(env.funder.id()).await, 4_000 * UNIT);
}

/// S-2.10's failure test, and the only one that exercises the rollback rather than the guard: the
/// contract debits the programme, the token then refuses to pay an account that has unregistered,
/// and `on_withdraw_paid` must put the debit back.
#[tokio::test]
async fn a_transfer_the_token_refuses_is_rolled_back() {
    let env = Env::setup().await;
    let programme_id = funded(&env).await;

    // Empty the funder's own wallet, then let it leave the token's registry — after that the
    // contract cannot pay it, and the failure is in the promise, not in our guard.
    env.register(&env.member_1).await;
    env.transfer(&env.funder, &env.member_1, 4_000).await;
    env.funder
        .call(env.token.id(), "storage_unregister")
        .args_json(json!({ "force": false }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await
        .expect("storage_unregister was not accepted")
        .into_result()
        .expect("storage_unregister reverted");

    withdraw(&env, programme_id, 100)
        .await
        .expect("the debit happens before the token is called");

    assert_eq!(
        reserved_and_balance(&env, programme_id).await,
        (1_000 * UNIT, 0),
        "the callback must restore what the refused transfer cost"
    );
    assert_eq!(env.tusdc_balance(env.funder.id()).await, 0);
    assert_eq!(
        env.tusdc_balance(env.member_1.id()).await,
        4_000 * UNIT,
        "the programme's money is still its own; only the funder's wallet moved"
    );
}

#[tokio::test]
async fn only_the_panel_dao_can_appoint_reviewers() {
    let env = Env::setup().await;
    let programme_id = funded(&env).await;

    let key_1 = vec![4u8; 32];
    let key_2 = vec![5u8; 32];
    let members = json!([
        { "account": env.member_1.id().as_str(), "x25519_pub": key_1 },
        { "account": env.member_2.id().as_str(), "x25519_pub": key_2 },
    ]);

    // The funder picking its own reviewers would be the whole game.
    let err = env
        .funder
        .call(env.sealedtip.id(), "set_panel")
        .args_json(json!({ "programme_id": programme_id, "members": members }))
        .transact()
        .await
        .expect("set_panel was not accepted")
        .into_result()
        .expect_err("a funder set the panel");
    assert!(
        err.to_string().contains("E05_NOT_PANEL_DAO"),
        "wrong rejection: {err}"
    );

    // One reviewer cannot satisfy a rule that exists to require two seals (E12/B10).
    let err = env
        .panel_dao
        .call(env.sealedtip.id(), "set_panel")
        .args_json(json!({
            "programme_id": programme_id,
            "members": [members.as_array().unwrap()[0].clone()],
        }))
        .transact()
        .await
        .expect("set_panel was not accepted")
        .into_result()
        .expect_err("a one-person panel was accepted");
    assert!(
        err.to_string().contains("E28_TOO_FEW_PANEL_MEMBERS"),
        "wrong rejection: {err}"
    );

    env.panel_dao
        .call(env.sealedtip.id(), "set_panel")
        .args_json(json!({ "programme_id": programme_id, "members": members }))
        .transact()
        .await
        .expect("set_panel was not accepted")
        .into_result()
        .expect("set_panel reverted");

    let panel = programme(&env, programme_id).await["panel"]
        .as_array()
        .cloned()
        .expect("panel is not an array");
    assert_eq!(panel.len(), 2);
    assert_eq!(
        panel[0]["account"],
        json!(env.member_1.id().as_str()),
        "the panel view must show who can read the sealed keys"
    );
}

/// S-2.11 over RPC: the shapes the frontend binds against, including the one that must be empty.
#[tokio::test]
async fn views_read_back_over_rpc() {
    let env = Env::setup().await;
    let programme_id = funded(&env).await;
    withdraw(&env, programme_id, 400).await.ok();

    let stats: serde_json::Value = env
        .sealedtip
        .view("get_programme_stats")
        .args_json(json!({ "programme_id": programme_id }))
        .await
        .expect("get_programme_stats view failed")
        .json()
        .expect("stats are not JSON");
    assert_eq!(stats["balance"], json!((600 * UNIT).to_string()));
    assert_eq!(stats["reserved"], json!("0"));
    assert_eq!(stats["submitted"], json!(0));
    assert_eq!(stats["keeper_last_seen"], json!("0"));

    let list: Vec<serde_json::Value> = env
        .sealedtip
        .view("list_programmes")
        .args_json(json!({ "from_index": 0, "limit": 10 }))
        .await
        .expect("list_programmes view failed")
        .json()
        .expect("the list is not JSON");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["id"], json!(programme_id));

    // No tips exist yet (S-3.1), and an unknown id is `null` rather than a panic.
    let missing: Option<serde_json::Value> = env
        .sealedtip
        .view("get_tip_public")
        .args_json(json!({ "tip_id": 99 }))
        .await
        .expect("get_tip_public view failed")
        .json()
        .expect("the tip view is not JSON");
    assert!(missing.is_none());

    // A dead programme id is an error, not a row of zeros a dashboard would read as "no tips yet".
    // A view panic comes back through the query layer, so the reason is only in the error chain's
    // debug output, not its Display — checked there rather than loosening the contract to return
    // `Option` and let "not found" look like "all zero".
    let err = env
        .sealedtip
        .view("get_programme_stats")
        .args_json(json!({ "programme_id": 42 }))
        .await
        .expect_err("stats for a missing programme returned zeros");
    assert!(
        format!("{err:?}").contains("E01_PROGRAMME_NOT_FOUND"),
        "rejected, but not for the documented reason: {err:?}"
    );
}

/// S-2.9 over RPC: the owner can rotate the relayers, and nobody else can — including the owner
/// trying to leave the system with a single relayer.
#[tokio::test]
async fn the_owner_rotates_relayers_and_nothing_else() {
    let env = Env::setup().await;
    let programme_id = open(&env, 500).await;

    let err = env
        .member_1
        .call(env.sealedtip.id(), "set_relayers")
        .args_json(json!({ "relayers": [env.member_1.id(), env.member_2.id()] }))
        .transact()
        .await
        .expect("set_relayers was not accepted")
        .into_result()
        .expect_err("a stranger rotated the relayers");
    assert!(
        err.to_string().contains("E08_NOT_OWNER"),
        "wrong rejection: {err}"
    );

    let err = env
        .owner
        .call(env.sealedtip.id(), "set_relayers")
        .args_json(json!({ "relayers": [env.relayer_1.id()] }))
        .transact()
        .await
        .expect("set_relayers was not accepted")
        .into_result()
        .expect_err("one relayer was accepted");
    assert!(
        err.to_string().contains("E27_TOO_FEW_RELAYERS"),
        "wrong rejection: {err}"
    );

    env.owner
        .call(env.sealedtip.id(), "set_relayers")
        .args_json(json!({
            "relayers": [env.member_2.id(), env.member_3.id()],
        }))
        .transact()
        .await
        .expect("set_relayers was not accepted")
        .into_result()
        .expect("set_relayers reverted");

    // The owner has no way to touch a programme's money: the funder's methods stay funder-only.
    // (E01 would come first for an id that does not exist, so this uses the live programme.)
    let err = env
        .owner
        .call(env.sealedtip.id(), "close_programme")
        .args_json(json!({ "programme_id": programme_id }))
        .transact()
        .await
        .expect("close_programme was not accepted")
        .into_result()
        .expect_err("the owner closed a programme");
    assert!(
        err.to_string().contains("E03_NOT_FUNDER"),
        "wrong rejection: {err}"
    );
}
