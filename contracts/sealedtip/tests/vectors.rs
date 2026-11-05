//! TS↔Rust parity: the Rust borsh derive re-encodes fixtures/vectors.json byte-for-byte and
//! `env::ed25519_verify` accepts the signatures @noble/ed25519 produced there. S-5.8 / S-0.5.
//! Regenerate with `pnpm gen-vectors`.

use near_sdk::borsh::to_vec;
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde::Deserialize;
use near_sdk::{env, AccountId};
use sealedtip::actions::{
    action_message, assert_signature, submit_message, DOMAIN_TAG, SUBMIT_TAG,
};
use sealedtip::types::{Action, CryptoHash, Ed25519PublicKey, Payout, SignedAction};

const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/vectors.json");

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)] // some fields are read only for assertion messages
struct Fixture {
    hkdf_labels: HkdfLabels,
    keys: Vec<KeyVector>,
    vectors: Vec<ActionVector>,
    submit: Vec<SubmitVector>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct HkdfLabels {
    ed25519: String,
    x25519: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[serde(rename_all = "snake_case")]
enum FixtureAction {
    Checkin,
    Retract,
    ClaimNear {
        account: String,
    },
    ClaimIntents {
        deposit_address: String,
        memo: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct ActionVector {
    name: String,
    key: String,
    contract: String,
    tip_id: u64,
    nonce: u64,
    action: FixtureAction,
    message: Vec<u8>,
    public_key: Vec<u8>,
    secret_key: Vec<u8>,
    signature: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct SubmitVector {
    name: String,
    programme_id: u64,
    evidence_hash: Vec<u8>,
    claim_pubkey: Vec<u8>,
    message: Vec<u8>,
    public_key: Vec<u8>,
    signature: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct KeyVector {
    name: String,
    secret: Vec<u8>,
    passphrase: Option<String>,
    words: Vec<String>,
    ed25519_secret: Vec<u8>,
    ed25519_public_key: Vec<u8>,
    x25519_secret: Vec<u8>,
    x25519_public_key: Vec<u8>,
}

fn fixture() -> Fixture {
    let raw = std::fs::read_to_string(VECTORS).expect("run `pnpm gen-vectors` first");
    near_sdk::serde_json::from_str(&raw).expect("vectors.json is malformed")
}

fn account_id(value: &str) -> AccountId {
    value.parse().expect("fixture account is invalid")
}

fn hash32(value: &[u8], name: &str) -> CryptoHash {
    value
        .try_into()
        .unwrap_or_else(|_| panic!("fixture field {name} must be 32 bytes"))
}

fn key32(value: &[u8], name: &str) -> Ed25519PublicKey {
    hash32(value, name)
}

fn signed_action(v: &ActionVector) -> SignedAction {
    let action = match &v.action {
        FixtureAction::Checkin => Action::Checkin,
        FixtureAction::Retract => Action::Retract,
        FixtureAction::ClaimNear { account } => Action::Claim {
            payout: Payout::Near {
                account: account_id(account),
            },
        },
        FixtureAction::ClaimIntents {
            deposit_address,
            memo,
        } => Action::Claim {
            payout: Payout::Intents {
                deposit_address: account_id(deposit_address),
                memo: memo.clone(),
            },
        },
    };
    SignedAction {
        contract: account_id(&v.contract),
        tip_id: v.tip_id,
        nonce: v.nonce,
        action,
    }
}

/// RFC 5869 HKDF-SHA256, one 32-byte output block. HMAC's zero-padding makes an absent salt
/// identical to HashLen zero bytes, which is what the browser passes.
fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut padded = [0u8; BLOCK];
    if key.len() > BLOCK {
        padded[..32].copy_from_slice(&env::sha256_array(key));
    } else {
        padded[..key.len()].copy_from_slice(key);
    }
    let mut inner = [0u8; BLOCK];
    let mut outer = [0u8; BLOCK];
    for i in 0..BLOCK {
        inner[i] = padded[i] ^ 0x36;
        outer[i] = padded[i] ^ 0x5c;
    }
    let mut buffer = inner.to_vec();
    buffer.extend_from_slice(data);
    let inner_hash = env::sha256_array(&buffer);
    let mut buffer = outer.to_vec();
    buffer.extend_from_slice(&inner_hash);
    env::sha256_array(&buffer)
}

fn hkdf_sha256(secret: &[u8], salt: &[u8], info: &[u8]) -> [u8; 32] {
    let prk = hmac_sha256(salt, secret);
    let mut block = info.to_vec();
    block.push(1);
    hmac_sha256(&prk, &block)
}

#[test]
fn borsh_bytes_match_fixture_vectors() {
    let data = fixture();
    assert!(
        data.vectors.len() >= 5,
        "fixture covers checkin, retract and every payout shape"
    );
    for vector in &data.vectors {
        let action = signed_action(vector);
        let message = action_message(&action);
        assert_eq!(
            message, vector.message,
            "{}: borsh bytes diverged",
            vector.name
        );
        assert_eq!(
            to_vec(&action).unwrap(),
            vector.message[DOMAIN_TAG.len()..],
            "{}: body without the domain tag",
            vector.name
        );
        assert!(
            near_sdk::borsh::from_slice::<SignedAction>(&vector.message[DOMAIN_TAG.len()..])
                .is_ok(),
            "{}: fixture must round-trip through the contract's own type",
            vector.name
        );
        assert_eq!(action.nonce, vector.nonce, "{}: nonce", vector.name);
    }
}

#[test]
fn signatures_match_fixture_vectors() {
    let data = fixture();
    for vector in &data.vectors {
        let pubkey = key32(&vector.public_key, "public_key");
        let signature = Base64VecU8(vector.signature.clone());
        // The signature was made in TypeScript; the chain's verifier is ed25519-dalek.
        assert!(
            env::ed25519_verify(
                vector.signature.as_slice().try_into().unwrap(),
                &vector.message,
                &pubkey
            ),
            "{}: noble signature rejected by env::ed25519_verify",
            vector.name
        );
        assert_signature(&vector.message, &signature, &pubkey);
    }
}

#[test]
fn a_repaid_or_redirected_claim_fails_the_chains_verifier() {
    let data = fixture();
    for vector in &data.vectors {
        let pubkey = key32(&vector.public_key, "public_key");
        let signature: [u8; 64] = vector.signature.as_slice().try_into().unwrap();

        // Same signature, one byte of the payout address changed: the relayer cannot redirect.
        let mut tampered = vector.message.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        assert!(
            !env::ed25519_verify(&signature, &tampered, &pubkey),
            "{}: flipped byte still verified",
            vector.name
        );

        // Replayed with the next nonce.
        let action = signed_action(vector);
        let replayed = action_message(&SignedAction {
            nonce: action.nonce + 1,
            ..action.clone()
        });
        assert!(
            !env::ed25519_verify(&signature, &replayed, &pubkey),
            "{}: nonce replay accepted",
            vector.name
        );

        // Signed for a different contract account.
        let elsewhere = action_message(&SignedAction {
            contract: account_id("other-sealedtip.testnet"),
            ..action
        });
        assert!(
            !env::ed25519_verify(&signature, &elsewhere, &pubkey),
            "{}: wrong contract accepted",
            vector.name
        );
    }
}

#[test]
fn submit_vectors_encode_and_verify() {
    let data = fixture();
    assert!(!data.submit.is_empty());
    for vector in &data.submit {
        let evidence = hash32(&vector.evidence_hash, "evidence_hash");
        let claim = key32(&vector.claim_pubkey, "claim_pubkey");
        let message = submit_message(vector.programme_id, &evidence, &claim);
        assert_eq!(
            message, vector.message,
            "{}: submit bytes diverged",
            vector.name
        );
        assert_eq!(message.len(), SUBMIT_TAG.len() + 72);
        assert_eq!(&message[..SUBMIT_TAG.len()], SUBMIT_TAG);
        let signature: [u8; 64] = vector.signature.as_slice().try_into().unwrap();
        assert!(
            env::ed25519_verify(
                &signature,
                &message,
                &key32(&vector.public_key, "public_key")
            ),
            "{}",
            vector.name
        );

        // A relayer cannot move the tip to another programme.
        let other = submit_message(vector.programme_id + 1, &evidence, &claim);
        assert!(
            !env::ed25519_verify(&signature, &other, &claim),
            "{}: programme id is not bound",
            vector.name
        );
    }
}

#[test]
fn hkdf_keys_match_fixture_vectors() {
    let data = fixture();
    assert_eq!(data.hkdf_labels.ed25519, "sealedtip/ed25519/v1");
    assert_eq!(data.hkdf_labels.x25519, "sealedtip/x25519/v1");
    for vector in &data.keys {
        assert_eq!(vector.words.len(), 24, "{}: recovery words", vector.name);
        let salt = vector.passphrase.clone().unwrap_or_default();
        let salt = salt.as_bytes();
        let ed = hkdf_sha256(&vector.secret, salt, data.hkdf_labels.ed25519.as_bytes());
        let x = hkdf_sha256(&vector.secret, salt, data.hkdf_labels.x25519.as_bytes());
        assert_eq!(
            ed.to_vec(),
            vector.ed25519_secret,
            "{}: HKDF ed25519 key",
            vector.name
        );
        assert_eq!(
            x.to_vec(),
            vector.x25519_secret,
            "{}: HKDF x25519 key",
            vector.name
        );
        assert_ne!(ed, x, "{}: labels must not collide", vector.name);
    }

    // An absent and an empty passphrase must derive the same key, or the tipster's words break.
    let bare = data
        .keys
        .iter()
        .find(|k| k.name == "no-passphrase")
        .expect("no-passphrase vector");
    let empty = data
        .keys
        .iter()
        .find(|k| k.name == "empty-passphrase")
        .expect("empty-passphrase vector");
    assert_eq!(
        bare.secret, empty.secret,
        "both vectors come from the same recovery words"
    );
    assert_eq!(bare.ed25519_secret, empty.ed25519_secret);
    assert_eq!(bare.x25519_secret, empty.x25519_secret);
    assert_eq!(bare.ed25519_public_key, empty.ed25519_public_key);

    let guarded = data
        .keys
        .iter()
        .find(|k| k.name == "with-passphrase")
        .expect("with-passphrase vector");
    assert_ne!(
        bare.ed25519_secret, guarded.ed25519_secret,
        "a passphrase must change the key"
    );

    // The key that signed the action vectors is the one the fixture says the words derive.
    let claim = data
        .vectors
        .iter()
        .find(|v| v.name == "checkin")
        .expect("checkin vector");
    assert_eq!(claim.secret_key, bare.ed25519_secret);
    assert_eq!(claim.public_key, bare.ed25519_public_key);
}
