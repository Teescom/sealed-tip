//! Unit-test state builders (S-2.12). All data here is invented — no real people, organisations
//! or documents (AGENTS "fixtures are fictional"). Compiled only for `cargo test`.

use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

use crate::types::{
    CryptoHash, Ed25519PublicKey, PanelMember, Programme, SealedKey, Tip, TipStatus,
    X25519PublicKey,
};
use crate::Contract;

pub fn acct(name: &str) -> AccountId {
    name.parse().expect("fictional account id should parse")
}

pub fn contract_account() -> AccountId {
    acct("sealedtip.testnet")
}
pub fn owner() -> AccountId {
    acct("owner.testnet")
}
pub fn relayer_1() -> AccountId {
    acct("relayer-1.testnet")
}
pub fn relayer_2() -> AccountId {
    acct("relayer-2.testnet")
}
pub fn keeper() -> AccountId {
    acct("keeper.testnet")
}
pub fn funder() -> AccountId {
    acct("funder.testnet")
}
pub fn panel_dao() -> AccountId {
    acct("panel-dao.testnet")
}
pub fn token() -> AccountId {
    acct("mock-ft.testnet")
}
pub fn member_1() -> AccountId {
    acct("panel-1.testnet")
}
pub fn member_2() -> AccountId {
    acct("panel-2.testnet")
}
pub fn member_3() -> AccountId {
    acct("panel-3.testnet")
}

pub const KEEPER_X25519: X25519PublicKey = [3; 32];
pub const MEMBER_X25519: X25519PublicKey = [4; 32];
pub const CLAIM_PUBKEY: Ed25519PublicKey = [7; 32];
pub const EVIDENCE_HASH: CryptoHash = [0x11; 32];
pub const CLEANING_REPORT_HASH: CryptoHash = [0x22; 32];

pub const HOUR_NS: u64 = 3_600_000_000_000;

pub fn panel() -> Vec<PanelMember> {
    [member_1(), member_2(), member_3()]
        .into_iter()
        .map(|account| PanelMember {
            account,
            x25519_pub: MEMBER_X25519,
        })
        .collect()
}

/// A funded, open programme: 1000 tokens, 500 max reward, PoW 12, real time.
pub fn make_programme() -> Programme {
    Programme {
        id: 0,
        funder: funder(),
        title: "Test programme".to_string(),
        scope_uri: "ipfs://scope-cid".to_string(),
        scope_hash: [0x33; 32],
        panel_dao: panel_dao(),
        panel: panel(),
        token: token(),
        max_reward: U128(500),
        balance: U128(1000),
        reserved: U128(0),
        ops_balance: NearToken::from_near(1),
        gas_drip: NearToken::from_millinear(50),
        pow_bits: 12,
        open: true,
        time_scale: 1,
        created_at: U64(0),
    }
}

/// A `Submitted` tip on programme 0, sealed to the first two panel members, no switch.
pub fn make_tip() -> Tip {
    Tip {
        id: 0,
        programme_id: 0,
        claim_pubkey: CLAIM_PUBKEY,
        nonce: 0,
        evidence_cid: "0a1b2c".to_string(),
        evidence_hash: EVIDENCE_HASH,
        sealed_keys: vec![
            SealedKey {
                member: member_1(),
                cid: "sealed-1".to_string(),
            },
            SealedKey {
                member: member_2(),
                cid: "sealed-2".to_string(),
            },
        ],
        recused: vec![],
        cleaning_report_hash: CLEANING_REPORT_HASH,
        attestation_hash: None,
        switch: None,
        status: TipStatus::Submitted,
        submitted_at: U64(HOUR_NS),
        triaged_by: None,
        released_keys: vec![],
    }
}

pub fn make_contract() -> Contract {
    Contract::new(
        owner(),
        vec![relayer_1(), relayer_2()],
        keeper(),
        KEEPER_X25519,
    )
}

/// The next call in this test runs as `caller` (the predecessor, i.e. the relayer or member).
pub fn as_caller(caller: AccountId) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(contract_account())
        .signer_account_id(caller.clone())
        .predecessor_account_id(caller)
        .block_timestamp(HOUR_NS);
    testing_env!(context.build());
}
