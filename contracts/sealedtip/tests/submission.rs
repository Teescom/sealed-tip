//! S-5.2 over RPC: what a relayer is allowed to put on chain, in the order the contract checks it.
//!
//! `src/tip.rs`'s unit tests already walk each guard with a mocked VM and a garbage signature. These
//! run the same rules against a real node with a real ed25519 keypair, so they additionally pin the
//! two things a unit test cannot: that the JSON body the API relayer will send is the body the
//! contract accepts, and that a signature made by `packages/crypto`'s TypeScript twin verifies here.
mod common;

use common::{Env, Submission};

/// The submission every test starts from: two honest sealed keys, no recusal, no switch, PoW off.
fn honest(env: &Env, programme_id: u64) -> Submission {
    Submission::new(programme_id, &env.member_1, &env.member_2)
}

#[tokio::test]
async fn pow_below_threshold_fails() {
    let env = Env::setup().await;
    // 12 bits, so the guard is real rather than always-true.
    let programme_id = env.open_programme(500, 12, 1).await;
    env.register(env.sealedtip.as_account()).await;
    env.fund_programme(programme_id, 1_000).await;

    let submission = honest(&env, programme_id);
    // Nonce 0 is not a proof: nothing about this evidence hash makes it start with 12 zero bits.
    let error = env
        .submit(&env.relayer_1, submission.clone())
        .await
        .expect_err("a random nonce should not clear a 12-bit target");
    assert!(
        error.contains("E11_POW_TOO_LOW"),
        "expected the PoW guard, got: {error}"
    );
    assert!(
        !env.has_tip(0).await,
        "a refused submission must store nothing"
    );

    // The same submission with a mined nonce is accepted, so the refusal above was the threshold and
    // not a target nobody could reach.
    let pow_nonce = env.mine_pow(&submission.evidence_hash, 12);
    let mut mined = submission;
    mined.pow_nonce = pow_nonce;
    let tip_id = env
        .submit(&env.relayer_1, mined)
        .await
        .unwrap_or_else(|e| panic!("nonce {pow_nonce} was mined for this exact target: {e}"));
    assert_eq!(tip_id, 0);
    assert_eq!(env.tip_status(tip_id).await, "Submitted");
}

#[tokio::test]
async fn bad_submit_signature_fails() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;

    let mut submission = honest(&env, programme_id);
    submission.wrong_signer = true;
    let error = env
        .submit(&env.relayer_1, submission)
        .await
        .expect_err("a key that is not the claimed one must not be able to open a tip");
    assert!(
        error.contains("E09_BAD_SIGNATURE"),
        "expected the signature guard, got: {error}"
    );
    assert!(!env.has_tip(0).await);
    // The tipster's own key over the same bytes is accepted, so E09 is about the signer alone.
    env.submit(&env.relayer_1, honest(&env, programme_id))
        .await
        .expect("the honest submission should pass");
}

#[tokio::test]
async fn fewer_than_two_sealed_keys_fails() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;

    // One member holding the key: no quorum, and the panel could never reconstruct the evidence.
    let one = Submission {
        sealed: vec![env.member_1.id().clone()],
        ..honest(&env, programme_id)
    };
    let error = env
        .submit(&env.relayer_1, one)
        .await
        .expect_err("one sealed key is not a quorum");
    assert!(
        error.contains("E12_TOO_FEW_SEALED_KEYS"),
        "expected the quorum guard, got: {error}"
    );

    // Two entries naming the same member are still one member (E28 applies the same rule to panels).
    let duplicated = Submission {
        sealed: vec![env.member_1.id().clone(), env.member_1.id().clone()],
        ..honest(&env, programme_id)
    };
    let error = env
        .submit(&env.relayer_1, duplicated)
        .await
        .expect_err("a duplicated member must not count as a second holder");
    assert!(
        error.contains("E12_TOO_FEW_SEALED_KEYS"),
        "expected the quorum guard, got: {error}"
    );
    assert!(!env.has_tip(0).await);
    env.submit(&env.relayer_1, honest(&env, programme_id))
        .await
        .expect("two distinct members should pass");
}

#[tokio::test]
async fn sealed_key_to_recused_member_fails() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;

    // The tipster recuses member_3 (say they work for the accused) and hands member_3 a key anyway:
    // the recusal and the key list contradict each other, so nothing is stored.
    let conflicted = Submission {
        sealed: vec![
            env.member_1.id().clone(),
            env.member_2.id().clone(),
            env.member_3.id().clone(),
        ],
        recused: vec![env.member_3.id().clone()],
        ..honest(&env, programme_id)
    };
    let error = env
        .submit(&env.relayer_1, conflicted)
        .await
        .expect_err("a key sealed to a member who is recused cannot be opened by anyone");
    assert!(
        error.contains("E13_SEALED_TO_RECUSED"),
        "expected the recusal guard, got: {error}"
    );
    assert!(!env.has_tip(0).await);

    // Recusing a member who holds no key is the normal case and must pass.
    let clean = Submission {
        recused: vec![env.member_3.id().clone()],
        ..honest(&env, programme_id)
    };
    env.submit(&env.relayer_1, clean)
        .await
        .expect("recusing a member who was never given a key is fine");
}

#[tokio::test]
async fn non_relayer_cannot_submit() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;

    // Every one of these is a fully valid submission; only the caller is wrong. The tipster has no
    // account to call with, so the funder, a panel member and the keeper cover the three roles that
    // might each wish they could push a tip onto the board.
    for caller in [
        &env.funder,
        &env.member_1,
        &env.keeper,
        &env.panel_dao,
        &env.owner,
    ] {
        let error = env
            .submit(caller, honest(&env, programme_id))
            .await
            .expect_err("a non-relayer must not be able to submit");
        assert!(
            error.contains("E04_NOT_RELAYER"),
            "{} reached: {error}",
            caller.id()
        );
    }
    assert!(
        !env.has_tip(0).await,
        "five refused calls must store nothing"
    );
    env.submit(&env.relayer_2, honest(&env, programme_id))
        .await
        .expect("either allow-listed relayer can submit");
}

#[tokio::test]
async fn closed_programme_rejects_tips() {
    let env = Env::setup().await;
    let programme_id = env.funded_programme(500, 1_000).await;
    env.call(
        &env.funder,
        "close_programme",
        serde_json::json!({ "programme_id": programme_id }),
    )
    .await
    .expect("the funder can close their own programme");

    let error = env
        .submit(&env.relayer_1, honest(&env, programme_id))
        .await
        .expect_err("a closed programme is not taking evidence");
    assert!(
        error.contains("E17_PROGRAMME_CLOSED"),
        "expected the closed guard, got: {error}"
    );
    assert!(!env.has_tip(0).await);

    // A second programme from the same funder is still open: closing is per-programme, not global.
    let other = env.funded_programme(500, 1_000).await;
    assert_ne!(other, programme_id);
    env.submit(&env.relayer_1, honest(&env, other))
        .await
        .expect("an open programme should take the tip");
}
