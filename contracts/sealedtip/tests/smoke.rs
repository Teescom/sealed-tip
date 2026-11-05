//! S-1.6 smoke test: the harness boots a sandbox node, deploys and initialises both contracts, and a
//! funded funder can pay a registered panel member over RPC. This is the gate every other test in this
//! directory runs on, so it checks the plumbing rather than the rules: account names, wasm on chain,
//! revert reporting, the four token views, a time jump.
mod common;

use common::{Env, KEEPER_X25519, UNIT};
use serde_json::json;

#[tokio::test]
async fn harness_boots_and_pays_a_panel_member() {
    let env = Env::setup().await;

    // Both contracts are live under the sandbox root, initialised from the real build output.
    assert!(env.sealedtip.id().as_str().ends_with(".test.near"));
    assert!(env.token.id().as_str().ends_with(".test.near"));
    let code = env.sealedtip.view_code().await.expect("view_code failed");
    assert!(
        code.len() > 1_000,
        "sealedtip wasm looks truncated: {} bytes",
        code.len()
    );

    // A second `new` must revert *because of the init guard*. The args are the same valid ones
    // setup() used, so this proves three things at once: the wasm on chain is the initialised
    // contract, the harness reports reverts to the test (every negative test in phases 2-5 depends
    // on that), and the reason is distinguishable from `MethodNotFound`.
    let re_init = env
        .sealedtip
        .call("new")
        .args_json(json!({
            "owner": env.owner.id(),
            "relayers": [env.relayer_1.id(), env.relayer_2.id()],
            "keeper": env.keeper.id(),
            "keeper_x25519_pub": KEEPER_X25519.to_vec(),
        }))
        .transact()
        .await
        .expect("the re-init transaction was not accepted")
        .into_result()
        .expect_err("a second new() on an already-initialised contract succeeded");
    let reason = re_init.to_string();
    assert!(
        reason.contains("already been initialized"),
        "re-init failed for the wrong reason: {reason}"
    );

    // mock-ft metadata is readable over RPC, so the token is a real NEP-141/148 contract.
    let metadata: serde_json::Value = env
        .token
        .view("ft_metadata")
        .await
        .expect("ft_metadata view failed")
        .json()
        .expect("ft_metadata is not JSON");
    assert_eq!(metadata["symbol"], "tUSDC");
    assert_eq!(metadata["decimals"], 6);

    // setup() minted 5,000 tUSDC to the funder.
    assert_eq!(env.tusdc_balance(env.funder.id()).await, 5_000 * UNIT);

    // A fresh member holds nothing until it registers and is paid.
    assert_eq!(env.tusdc_balance(env.member_1.id()).await, 0);
    let stored: Option<serde_json::Value> = env
        .token
        .view("storage_balance_of")
        .args_json(json!({ "account_id": env.member_1.id() }))
        .await
        .expect("storage_balance_of view failed")
        .json()
        .expect("storage_balance_of is not JSON");
    assert!(
        stored.is_none(),
        "member_1 is already registered: {stored:?}"
    );

    let min_deposit = env.register(&env.member_1).await;
    assert!(min_deposit.as_yoctonear() > 0);

    env.transfer(&env.funder, &env.member_1, 120).await;
    assert_eq!(env.tusdc_balance(env.member_1.id()).await, 120 * UNIT);
    assert_eq!(env.tusdc_balance(env.funder.id()).await, 4_880 * UNIT);

    // `mint` registers for free, unlike `ft_transfer`.
    env.mint(&env.member_2, 10).await;
    assert_eq!(env.tusdc_balance(env.member_2.id()).await, 10 * UNIT);

    // Total supply moves with mints only, never with transfers.
    assert_eq!(env.total_supply().await, 5_010 * UNIT);

    // Time travel works. 30 s of chain time = 120 blocks ≈ 1.5 s of wall time, and it is far more
    // than the node mints on its own while the test runs (250 ms per block) — an hour would cost
    // 2-4 minutes, so the 24 h deadlines use demo `time_scale` instead. See `Env::advance`.
    let before = env.now_ns().await;
    let height_before = env.height().await;
    env.advance(30_000_000_000).await;
    let moved = env.now_ns().await - before;
    let blocks = env.height().await - height_before;
    assert!(
        moved >= 30_000_000_000,
        "advance(30s) moved only {moved} ns of chain time"
    );
    assert!(blocks >= 120, "advance(30s) produced only {blocks} blocks");

    // The tipster has no account; its key is what the contract authorises.
    assert_eq!(env.tipster_pubkey().len(), 32);
}
