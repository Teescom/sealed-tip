//! Unit-test state builders (S-2.12). All data here is invented — no real people, organisations
//! or documents (AGENTS "fixtures are fictional"). Compiled only for `cargo test`.

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

use crate::types::{
    Action, CryptoHash, Ed25519PublicKey, PanelMember, Programme, SealedKey, SignedAction, Switch,
    Tip, TipId, TipStatus, X25519PublicKey,
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
pub const EVIDENCE_HASH: CryptoHash = [0x11; 32];
pub const CLEANING_REPORT_HASH: CryptoHash = [0x22; 32];

pub const HOUR_NS: u64 = 3_600_000_000_000;

/// The unit fixtures' tipster key pair. The secret is `sha256` of a label, which is how the sandbox
/// harness derives its keys too — same construction, different label, so neither world can be
/// confused for the other. `ed25519-dalek` is a dev-dependency and the mock host implements
/// `env::ed25519_verify`, so a unit test can reach the rules *behind* a signature rather than only
/// the ones in front of it.
pub fn tipster_key() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::from_bytes(&near_sdk::env::sha256_array(b"sealedtip.unit.tipster"))
}

/// The public half, i.e. what `submit_tip` records as a tip's `claim_pubkey`.
pub fn claim_pubkey() -> Ed25519PublicKey {
    tipster_key().verifying_key().to_bytes()
}

/// `signature` over the bytes a tipster signs for one action on this fixture contract.
pub fn sign(message: &[u8]) -> Base64VecU8 {
    use ed25519_dalek::Signer as _;
    Base64VecU8(tipster_key().sign(message).to_bytes().to_vec())
}

/// As above for a whole `SignedAction`, so a test can sign the exact bytes and then break one field.
pub fn sign_action(tip_id: TipId, nonce: u64, action: Action) -> Base64VecU8 {
    sign(&crate::actions::action_message(&SignedAction {
        contract: contract_account(),
        tip_id,
        nonce,
        action,
    }))
}

/// As `sign_action`, but over bytes naming a different account: the shape of a signature taken from
/// another deployment of this contract.
pub fn sign_action_at(contract: &str, tip_id: TipId, nonce: u64, action: Action) -> Base64VecU8 {
    sign(&crate::actions::action_message(&SignedAction {
        contract: acct(contract),
        tip_id,
        nonce,
        action,
    }))
}

/// The fixture tip after one tipster action has already been consumed.
pub fn tip_with_nonce(nonce: u64) -> Tip {
    let mut tip = make_tip();
    tip.nonce = nonce;
    tip
}

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
        claim_pubkey: claim_pubkey(),
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

/// A tip with a dead man's switch, armed the way `submit_tip` arms it in real time: due at
/// `submitted_at + interval`, and `grace` past that before anyone may trigger it.
pub fn tip_with_switch(mut tip: Tip, interval: u64, grace: u64) -> Tip {
    tip.switch = Some(Switch {
        interval: U64(interval),
        grace: U64(grace),
        next_deadline: U64(tip.submitted_at.0 + interval),
        bundle_key_for_keeper: "k-switch".to_string(),
        includes_raw: false,
        triggered: false,
    });
    tip
}

/// Programme 0 plus a `Submitted` tip whose switch is due one day after it was submitted, with four
/// hours of grace — the state the S-3.6–S-3.8 rules are about.
pub fn contract_with_armed_tip() -> Contract {
    contract_with(
        vec![make_programme()],
        vec![tip_with_switch(make_tip(), 24 * HOUR_NS, 4 * HOUR_NS)],
    )
}

pub fn make_contract() -> Contract {
    Contract::new(
        owner(),
        vec![relayer_1(), relayer_2()],
        keeper(),
        KEEPER_X25519,
    )
}

/// A contract with the given programmes and tips already in state, and the id counters advanced
/// past them — i.e. the shape `create_programme` / `submit_tip` would leave behind.
pub fn contract_with(programmes: Vec<Programme>, tips: Vec<Tip>) -> Contract {
    let mut contract = make_contract();
    for programme in programmes {
        contract.next_programme_id = contract.next_programme_id.max(programme.id + 1);
        contract.programmes.insert(programme.id, programme);
    }
    for tip in tips {
        contract.next_tip_id = contract.next_tip_id.max(tip.id + 1);
        contract.tips.insert(tip.id, tip);
    }
    contract
}

/// The single default programme and tip, as `contract_with` would hold them.
pub fn contract_with_programme() -> Contract {
    contract_with(vec![make_programme()], vec![])
}

pub fn contract_with_tip() -> Contract {
    contract_with(vec![make_programme()], vec![make_tip()])
}

pub fn programme_balances(balance: u128, reserved: u128) -> Programme {
    let mut programme = make_programme();
    programme.balance = U128(balance);
    programme.reserved = U128(reserved);
    programme
}

pub fn tip_with_status(id: u64, programme_id: u64, status: TipStatus) -> Tip {
    let mut tip = make_tip();
    tip.id = id;
    tip.programme_id = programme_id;
    tip.status = status;
    tip
}

/// The next call in this test runs as `caller` (the predecessor, i.e. the relayer or member).
pub fn as_caller(caller: AccountId) {
    as_caller_at(caller, HOUR_NS, NearToken::from_yoctonear(0));
}

/// As above, carrying `attached` NEAR — what `create_programme` turns into `ops_balance`.
pub fn as_caller_with_deposit(caller: AccountId, attached: NearToken) {
    as_caller_at(caller, HOUR_NS, attached);
}

/// As above, in the block at `now_ns`. The switch rules are about *when*, so a test has to be able to
/// stand in a later block than the one a tip was submitted in.
pub fn as_caller_at(caller: AccountId, now_ns: u64, attached: NearToken) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(contract_account())
        .signer_account_id(caller.clone())
        .predecessor_account_id(caller)
        .attached_deposit(attached)
        .block_timestamp(now_ns);
    testing_env!(context.build());
}
