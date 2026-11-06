//! Sandbox harness (S-1.6): deploy sealedtip + mock-ft; relayers, keeper, panel, funder.
//!
//! Every test gets its own sandbox node (`near_workspaces::sandbox()`), its own accounts and its own
//! pair of deployed contracts, so tests can run in parallel without sharing state. Account names mirror
//! the testnet layout in `.env.example` under the sandbox root: `sealedtip.test.near`, `tusdc.test.near`.
//!
//! The wasm is not compiled here: `pnpm test` runs `pnpm build:contract` first. Run that before
//! `cargo test --test smoke` on a fresh clone.
#![allow(dead_code)]

use std::path::PathBuf;

use ed25519_dalek::Signer as _;
use near_sdk::json_types::Base64VecU8;
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use sealedtip::types::{Action, SignedAction};
use serde_json::json;

/// 1 tUSDC in base units (6 decimals, same as USDC).
pub const UNIT: u128 = 1_000_000;

/// Lower bound on the chain time a sandbox block advances by, in nanoseconds (`min_block_time` is
/// 250 ms). Measured on this machine: `fast_forward(1000)` moved 1002 blocks / 297.8 s of chain time
/// in 8.9 s wall, and `fast_forward(14400)` moved an hour of chain time in 228.9 s wall — so roughly
/// 9-16 ms of wall time per block. `advance` divides by this, so it may over-advance blocks but never
/// under-advance the requested time, and the loop re-measures after each jump.
const MIN_BLOCK_TIME_NS: u64 = 250_000_000;

/// Keeper's X25519 public key: a fixed 32 bytes, only meaningful as an identifier in these tests.
pub const KEEPER_X25519: [u8; 32] = [3; 32];

const SEALED_TIP_WASM: &str = "../../target/near/sealedtip/sealedtip.wasm";
const MOCK_FT_WASM: &str = "../../target/near/mock_ft/mock_ft.wasm";

fn wasm(relative: &str, built_by: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "{} is not readable ({e}). Run `{built_by}` first — the sandbox deploys real wasm.",
            path.display()
        )
    })
}

fn key(purpose: &str) -> SecretKey {
    SecretKey::from_seed(KeyType::ED25519, purpose)
}

/// The tipster's key pair, for signing *messages*. `near_workspaces::types::SecretKey` signs
/// transactions but exposes no `sign` method and no raw bytes, and `submit_tip` takes its signature
/// as `Base64VecU8`, so message signing uses `ed25519-dalek` — the crate the chain's
/// `env::ed25519_verify` is built on, so a signature made here is checked by the same math that
/// checks it on mainnet (and `tests/vectors.rs` pins that math against TypeScript).
///
/// The seed is `sha256(purpose)`: a fixture key over fictional data, hashed rather than truncated so
/// two purposes that share a prefix cannot quietly become the same key.
fn message_key(purpose: &str) -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::from_bytes(&near_sdk::env::sha256_array(purpose.as_bytes()))
}

/// A sandbox with both contracts deployed and funded, plus the accounts every phase needs.
pub struct Env {
    pub worker: Worker<Sandbox>,
    /// Root of the sandbox; pays for the accounts below and holds nothing else.
    pub root: Account,
    pub sealedtip: Contract,
    pub token: Contract,
    pub owner: Account,
    pub relayer_1: Account,
    pub relayer_2: Account,
    pub keeper: Account,
    pub funder: Account,
    /// The Sputnik DAO that triages and resolves. Still a plain account: the pinned
    /// `sputnikdao2.wasm` is on `main` (`contracts/sealedtip/res/`) but the harness doesn't deploy
    /// it yet, so `panel_dao` is where it plugs in (S-2.6 / S-2.8).
    pub panel_dao: Account,
    pub member_1: Account,
    pub member_2: Account,
    pub member_3: Account,
    /// The anonymous tipster has no account. This is the ed25519 key its actions are signed with,
    /// fixed so a signature in a test is reproducible.
    pub tipster: ed25519_dalek::SigningKey,
}

impl Env {
    /// Boot a node, deploy the contracts, init sealedtip, and give the funder 5,000 tUSDC.
    pub async fn setup() -> Env {
        let worker = near_workspaces::sandbox()
            .await
            .expect("sandbox node failed to start (near-sandbox binary + 127.0.0.1 RPC)");
        let root = worker.root_account().expect("sandbox has no root account");

        let token = deploy(&root, "tusdc", MOCK_FT_WASM, "pnpm build:contract").await;
        let sealedtip = deploy(&root, "sealedtip", SEALED_TIP_WASM, "pnpm build:contract").await;

        let owner = account(&root, "owner").await;
        let relayer_1 = account(&root, "relayer1").await;
        let relayer_2 = account(&root, "relayer2").await;
        let keeper = account(&root, "keeper").await;
        let funder = account(&root, "funder").await;
        let panel_dao = account(&root, "paneldao").await;
        let member_1 = account(&root, "member1").await;
        let member_2 = account(&root, "member2").await;
        let member_3 = account(&root, "member3").await;

        token
            .call("new")
            .args_json(json!({}))
            .transact()
            .await
            .expect("mock-ft new() failed")
            .into_result()
            .expect("mock-ft new() reverted");

        sealedtip
            .call("new")
            .args_json(json!({
                "owner": owner.id(),
                "relayers": [relayer_1.id(), relayer_2.id()],
                "keeper": keeper.id(),
                // X25519PublicKey is [u8; 32], which serde carries as 32 numbers.
                "keeper_x25519_pub": KEEPER_X25519.to_vec(),
            }))
            .transact()
            .await
            .expect("sealedtip new() failed")
            .into_result()
            .unwrap_or_else(|e| panic!("sealedtip new() reverted: {}", e));

        let env = Env {
            worker,
            root,
            sealedtip,
            token,
            owner,
            relayer_1,
            relayer_2,
            keeper,
            funder,
            panel_dao,
            member_1,
            member_2,
            member_3,
            tipster: message_key("tipster.seed"),
        };
        // Faucet the funder so programme tests can fund reservations without a mint step.
        env.mint(&env.funder, 5_000).await;
        env
    }

    /// NEP-141 `mint` — open on this token by design.
    pub async fn mint(&self, to: &Account, units: u128) {
        self.token
            .call("mint")
            .args_json(json!({ "account_id": to.id(), "amount": (units * UNIT).to_string() }))
            .gas(Gas::from_tgas(50))
            .transact()
            .await
            .expect("mint failed")
            .into_result()
            .unwrap_or_else(|e| panic!("mint reverted: {}", e));
    }

    /// `storage_deposit` at exactly the NEP-145 minimum. Needed before receiving a transfer:
    /// unlike `mint`, `ft_transfer` will not register the receiver.
    pub async fn register(&self, who: &Account) -> NearToken {
        let min: String = self
            .token
            .view("storage_balance_bounds")
            .await
            .expect("storage_balance_bounds view failed")
            .json::<serde_json::Value>()
            .expect("storage_balance_bounds is not JSON")
            .get("min")
            .and_then(|v| v.as_str())
            .expect("no min in storage_balance_bounds")
            .to_string();
        let min = yocto(&min);
        who.call(self.token.id(), "storage_deposit")
            .args_json(json!({}))
            .deposit(min)
            .transact()
            .await
            .expect("storage_deposit failed")
            .into_result()
            .unwrap_or_else(|e| panic!("storage_deposit reverted: {}", e));
        min
    }

    /// `ft_transfer`, which needs the receiver registered and exactly 1 yoctoNEAR attached.
    pub async fn transfer(&self, from: &Account, to: &Account, units: u128) {
        from.call(self.token.id(), "ft_transfer")
            .args_json(json!({
                "receiver_id": to.id(),
                "amount": (units * UNIT).to_string(),
            }))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await
            .expect("ft_transfer failed")
            .into_result()
            .unwrap_or_else(|e| panic!("ft_transfer reverted: {}", e));
    }

    pub async fn tusdc_balance(&self, who: &AccountId) -> u128 {
        let amount: String = self
            .token
            .view("ft_balance_of")
            .args_json(json!({ "account_id": who }))
            .await
            .expect("ft_balance_of view failed")
            .json()
            .expect("ft_balance_of is not a JSON string");
        amount
            .parse()
            .expect("ft_balance_of returned a non-numeric amount")
    }

    pub async fn total_supply(&self) -> u128 {
        let amount: String = self
            .token
            .view("ft_total_supply")
            .await
            .expect("ft_total_supply view failed")
            .json()
            .expect("ft_total_supply is not a JSON string");
        amount
            .parse()
            .expect("ft_total_supply returned a non-numeric amount")
    }

    pub async fn near_balance(&self, who: &Account) -> NearToken {
        who.view_account()
            .await
            .expect("view_account failed")
            .balance
    }

    /// Current block timestamp in nanoseconds — what the contract compares deadlines against.
    pub async fn now_ns(&self) -> u64 {
        self.worker
            .view_block()
            .await
            .expect("view_block failed")
            .timestamp()
    }

    /// Current block height, to tell a real time jump from the ~4 blocks/s the node mints by itself.
    pub async fn height(&self) -> u64 {
        self.worker
            .view_block()
            .await
            .expect("view_block failed")
            .height()
    }

    /// Move chain time forward by at least `ns` using the sandbox's `fast_forward`. Cost is linear in
    /// blocks (~9-16 ms wall each), so an hour of chain time costs 2-4 minutes and the real 24 h
    /// deadlines would cost ~86k blocks / 13-23 minutes. Tests run in demo mode (`time_scale` > 1),
    /// where 24 h is compressed to 60 s = 240 blocks ≈ 3 s.
    ///
    /// The node also produces a block every `min_block_time` (250 ms) on its own, so an assertion that
    /// only needs a few hundred ms of chain time can pass with `fast_forward` removed. Demand a jump
    /// bigger than the wall time the test spends.
    pub async fn advance(&self, ns: u64) {
        let mut remaining = ns;
        while remaining > 0 {
            let blocks = (remaining / MIN_BLOCK_TIME_NS).max(1);
            let before = self.now_ns().await;
            self.worker
                .fast_forward(blocks)
                .await
                .expect("fast_forward failed");
            let moved = self.now_ns().await.saturating_sub(before);
            remaining = remaining.saturating_sub(moved);
        }
    }

    /// The tipster's key as the contract's `Ed25519PublicKey` (`[u8; 32]`), ready for a `SignedAction`.
    pub fn tipster_pubkey(&self) -> [u8; 32] {
        self.tipster.verifying_key().to_bytes()
    }

    // --- programme helpers (shared by every suite that needs an escrow) -----------------------

    /// Open a programme as the funder. `max_reward_units` is in tUSDC, `pow_bits` is what a tipster
    /// must burn to submit, and `time_scale` above 1 is demo mode (24 h becomes one minute at 1440).
    pub async fn open_programme(
        &self,
        max_reward_units: u128,
        pow_bits: u8,
        time_scale: u32,
    ) -> u64 {
        let scope_hash = vec![0x33u8; 32];
        let result = self
            .funder
            .call(self.sealedtip.id(), "create_programme")
            .args_json(json!({
                "title": "Public interest fund",
                "scope_uri": "https://scope.example/rules",
                "scope_hash": scope_hash,
                "panel_dao": self.panel_dao.id(),
                "token": self.token.id(),
                "max_reward": (max_reward_units * UNIT).to_string(),
                "gas_drip": DRIP,
                "pow_bits": pow_bits,
                "time_scale": time_scale,
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
    /// Nothing is returned: a `ft_on_transfer` panic lands in a later receipt, so the outer
    /// transaction succeeds anyway and the only honest check is what the balances end up as.
    pub async fn fund_programme(&self, programme_id: u64, units: u128) {
        let _ = self
            .funder
            .call(self.token.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": self.sealedtip.id(),
                "amount": (units * UNIT).to_string(),
                "memo": format!("programme {programme_id}"),
                "msg": fund_msg(programme_id),
            }))
            // NEP-141 requires exactly 1 yoctoNEAR on `ft_transfer_call`.
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(100))
            .transact()
            .await
            .expect("ft_transfer_call was not accepted");
    }

    /// The panel DAO seats the reviewers. `create_programme` leaves `panel` empty on purpose — a
    /// funder that could choose its own judges could choose one that always agrees (invariant 4) —
    /// so on the real layout a Sputnik DAO vote calls `set_panel`. Here `panel_dao` is still a plain
    /// account, so the test makes that one call as the DAO.
    pub async fn seat_panel(&self, programme_id: u64, members: &[&Account]) {
        let panel: Vec<serde_json::Value> = members
            .iter()
            .enumerate()
            .map(|(index, member)| {
                json!({
                    "account": member.id(),
                    // A distinct key per member; the contract only stores it for the client to
                    // encrypt a sealed key to, so any recognisable byte pattern will do.
                    "x25519_pub": vec![index as u8 + 1; 32],
                })
            })
            .collect();
        self.call(
            &self.panel_dao,
            "set_panel",
            json!({ "programme_id": programme_id, "members": panel }),
        )
        .await
        .unwrap_or_else(|e| panic!("the panel DAO could not seat its reviewers: {e}"));
    }

    /// Open a programme and put `units` of tUSDC in it, registering the contract with the token
    /// first — the state most tip-lifecycle tests start from.
    pub async fn funded_programme(&self, max_reward_units: u128, units: u128) -> u64 {
        self.funded_programme_scaled(max_reward_units, units, 1)
            .await
    }

    /// As above, at a chosen `time_scale`. Demo mode (1440) is what lets a switch test wait out a
    /// 24 h deadline in a minute of chain time instead of ~90,000 blocks of `fast_forward`.
    pub async fn funded_programme_scaled(
        &self,
        max_reward_units: u128,
        units: u128,
        time_scale: u32,
    ) -> u64 {
        let programme_id = self.open_programme(max_reward_units, 0, time_scale).await;
        self.seat_panel(
            programme_id,
            &[&self.member_1, &self.member_2, &self.member_3],
        )
        .await;
        self.register(self.sealedtip.as_account()).await;
        self.fund_programme(programme_id, units).await;
        let (balance, _) = self.programme_money(programme_id).await;
        assert_eq!(
            balance,
            units * UNIT,
            "the programme did not take the funding — the harness cannot test against an empty escrow"
        );
        programme_id
    }

    pub async fn programme_view(&self, programme_id: u64) -> serde_json::Value {
        self.sealedtip
            .view("get_programme")
            .args_json(json!({ "programme_id": programme_id }))
            .await
            .expect("get_programme view failed")
            .json::<Option<serde_json::Value>>()
            .expect("get_programme is not JSON")
            .unwrap_or_else(|| panic!("programme {programme_id} is missing"))
    }

    /// The money the contract holds for this programme, in tUSDC base units: (balance, reserved).
    pub async fn programme_money(&self, programme_id: u64) -> (u128, u128) {
        let programme = self.programme_view(programme_id).await;
        let amount = |field: &str| {
            programme[field]
                .as_str()
                .unwrap_or_else(|| panic!("{field} is not a decimal string: {programme}"))
                .parse()
                .expect("amount is not a number")
        };
        (amount("balance"), amount("reserved"))
    }

    pub async fn withdraw(&self, programme_id: u64, units: u128) -> Result<(), String> {
        self.funder
            .call(self.sealedtip.id(), "withdraw_unreserved")
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

    /// Withdraw `units`, then prove the funder's wallet really gained them. A call that returns
    /// successfully while moving a different amount is exactly the bug this suite guards against,
    /// so every positive withdrawal assertion goes through here.
    pub async fn withdraw_check(&self, programme_id: u64, units: u128) -> Result<(), String> {
        let before = self.tusdc_balance(self.funder.id()).await;
        self.withdraw(programme_id, units).await?;
        let after = self.tusdc_balance(self.funder.id()).await;
        let moved = after
            .checked_sub(before)
            .unwrap_or_else(|| panic!("withdraw_unreserved moved the funder's balance down"));
        assert_eq!(
            moved,
            units * UNIT,
            "withdraw_unreserved returned success but sent a different amount"
        );
        Ok(())
    }

    // --- tip helpers --------------------------------------------------------------------------

    /// The bytes the tipster signs at submission, made with the contract's own builder. Its layout
    /// is pinned from the outside by `tests/vectors.rs`, which checks the same function against
    /// signatures produced in TypeScript, so a test here cannot quietly redefine the wire format.
    pub fn submit_message(&self, programme_id: u64, evidence_hash: &[u8; 32]) -> Vec<u8> {
        sealedtip::actions::submit_message(programme_id, evidence_hash, &self.tipster_pubkey())
    }

    pub fn tipster_signature(&self, message: &[u8]) -> Vec<u8> {
        self.tipster.sign(message).to_bytes().to_vec()
    }

    /// The bytes a tipster's action is signed over, built with the contract's own `action_message`
    /// so that the deployed code decides the wire format. The signed payload names *this* deployment
    /// (`SignedAction::contract`), which is what makes a signature minted for one contract useless
    /// against another; a test that wanted to break that has to say so explicitly, via
    /// `signed_action_on`.
    pub fn action_message(&self, tip_id: u64, nonce: u64, action: Action) -> Vec<u8> {
        sealedtip::actions::action_message(&SignedAction {
            contract: self.sealedtip.id().clone(),
            tip_id,
            nonce,
            action,
        })
    }

    /// A tipster-signed action, ready to hand to a relayer. Defaults are the honest case: right key,
    /// right contract, right tip.
    pub fn signed_action(&self, tip_id: u64, nonce: u64, action: Action) -> Base64VecU8 {
        let message = self.action_message(tip_id, nonce, action);
        Base64VecU8::from(self.tipster_signature(&message))
    }

    /// The same action signed by a key that is not the tipster's — the case where a relayer (or
    /// anyone who copied a valid call) guesses the payload and signs it themselves.
    pub fn signed_action_wrong_key(&self, tip_id: u64, nonce: u64, action: Action) -> Base64VecU8 {
        let message = self.action_message(tip_id, nonce, action);
        let impostor = message_key("not-the-tipster.seed");
        Base64VecU8::from(impostor.sign(&message).to_bytes().to_vec())
    }

    /// The same action signed for a *different* contract account. Everything the tipster signed is
    /// identical apart from the deployment name, so if the contract did not include it in the
    /// message, this signature would verify.
    pub fn signed_action_on(
        &self,
        contract: &AccountId,
        tip_id: u64,
        nonce: u64,
        action: Action,
    ) -> Base64VecU8 {
        let message = sealedtip::actions::action_message(&SignedAction {
            contract: contract.clone(),
            tip_id,
            nonce,
            action,
        });
        Base64VecU8::from(self.tipster_signature(&message))
    }

    /// `checkin` / `retract` as a relayer forwards them. The signature is built from the action the
    /// test names, so an honest call cannot sign one thing and send another by accident; the tests
    /// that mean to do exactly that go through `signed_call_with`.
    pub async fn signed_call(
        &self,
        who: &Account,
        method: &str,
        tip_id: u64,
        nonce: u64,
        action: Action,
    ) -> Result<(), String> {
        let signature = self.signed_action(tip_id, nonce, action);
        self.signed_call_with(who, method, tip_id, nonce, &signature)
            .await
    }

    /// As above, with a signature the caller built by hand — the wrong-key, wrong-deployment and
    /// spent-nonce cases.
    pub async fn signed_call_with(
        &self,
        who: &Account,
        method: &str,
        tip_id: u64,
        nonce: u64,
        signature: &Base64VecU8,
    ) -> Result<(), String> {
        self.call(
            who,
            method,
            json!({ "tip_id": tip_id, "nonce": nonce, "signature": signature }),
        )
        .await
    }

    /// A tip id that does not exist in this deployment — the argument for the "not found" guards.
    pub const MISSING_TIP: u64 = 4242;

    /// One call as one account, with the sealed-key and recusal knobs a submission test needs.
    pub async fn submit(&self, who: &Account, s: Submission) -> Result<u64, String> {
        let claim_pubkey = self.tipster_pubkey();
        let sealed_keys: Vec<serde_json::Value> = s
            .sealed
            .iter()
            .map(|member| json!({ "member": member, "cid": format!("sealed-{member}") }))
            .collect();
        let message = self.submit_message(s.programme_id, &s.evidence_hash);
        // `wrong_signer` signs the same bytes with a different fixture key, so the payload, the PoW
        // and the sealed keys all stay valid and the only rule left standing is E09.
        let signer = if s.wrong_signer {
            message_key("not-the-tipster.seed")
        } else {
            self.tipster.clone()
        };
        let signature = signer.sign(&message).to_bytes().to_vec();
        let switch: Option<serde_json::Value> = s.switch.map(|(interval, grace)| {
            json!({
                "interval": interval.to_string(),
                "grace": grace.to_string(),
                "bundle_key_for_keeper": "k-switch",
                "includes_raw": false,
            })
        });
        let result = who
            .call(self.sealedtip.id(), "submit_tip")
            .args_json(json!({
                "programme_id": s.programme_id,
                "claim_pubkey": claim_pubkey.to_vec(),
                "evidence_cid": format!("0a1b2c-{}", s.evidence_hash[0]),
                "evidence_hash": s.evidence_hash.to_vec(),
                "sealed_keys": sealed_keys,
                "recused": s.recused,
                "cleaning_report_hash": vec![0x22u8; 32],
                "attestation_hash": null,
                "switch": switch,
                "pow_nonce": s.pow_nonce,
                "signature": Base64VecU8::from(signature),
            }))
            .gas(Gas::from_tgas(100))
            .transact()
            .await
            .expect("submit_tip was not accepted")
            .into_result()
            .map_err(|e| e.to_string())?;
        result
            .json::<u64>()
            .map_err(|e| format!("tip id is not a number: {e}"))
    }

    /// Call one of the panel-side methods as `who` and report the revert text, if any.
    pub async fn call(
        &self,
        who: &Account,
        method: &str,
        args: serde_json::Value,
    ) -> Result<(), String> {
        who.call(self.sealedtip.id(), method)
            .args_json(args)
            .gas(Gas::from_tgas(100))
            .transact()
            .await
            .expect("transaction was not accepted")
            .into_result()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Whether a tip id exists at all — the check that a refused submission created nothing, as
    /// opposed to creating a tip in some unexpected state.
    pub async fn has_tip(&self, tip_id: u64) -> bool {
        self.sealedtip
            .view("get_tip_public")
            .args_json(json!({ "tip_id": tip_id }))
            .await
            .expect("get_tip_public view failed")
            .json::<Option<serde_json::Value>>()
            .expect("get_tip_public is not JSON")
            .is_some()
    }

    /// `get_programme_stats`: the money and the per-status counts the panel UI reads.
    pub async fn programme_stats(&self, programme_id: u64) -> serde_json::Value {
        self.sealedtip
            .view("get_programme_stats")
            .args_json(json!({ "programme_id": programme_id }))
            .await
            .expect("get_programme_stats view failed")
            .json::<serde_json::Value>()
            .expect("get_programme_stats is not JSON")
    }

    /// The whole stored tip, as the panel reads it through `get_tip_for_panel`.
    pub async fn tip_view(&self, tip_id: u64) -> serde_json::Value {
        self.sealedtip
            .view("get_tip_for_panel")
            .args_json(json!({ "tip_id": tip_id }))
            .await
            .expect("get_tip_for_panel view failed")
            .json::<Option<serde_json::Value>>()
            .expect("get_tip_for_panel is not JSON")
            .unwrap_or_else(|| panic!("tip {tip_id} is missing"))
    }

    /// What anybody without a panel seat can see: status, deadline, whether the switch fired.
    pub async fn tip_public(&self, tip_id: u64) -> serde_json::Value {
        self.sealedtip
            .view("get_tip_public")
            .args_json(json!({ "tip_id": tip_id }))
            .await
            .expect("get_tip_public view failed")
            .json::<Option<serde_json::Value>>()
            .expect("get_tip_public is not JSON")
            .unwrap_or_else(|| panic!("tip {tip_id} is missing"))
    }

    /// The number of nanoseconds `get_programme_stats` reports for the keeper's last heartbeat.
    pub async fn keeper_last_seen(&self, programme_id: u64) -> u64 {
        let seen = &self.programme_stats(programme_id).await["keeper_last_seen"];
        seen.as_str()
            .unwrap_or_else(|| panic!("keeper_last_seen is not a decimal string: {seen}"))
            .parse()
            .expect("keeper_last_seen is not a number")
    }

    /// The armed switch deadline from `get_tip_public`, in ns. Panics if the field is null, because
    /// every caller of it is asserting on a tip that must be armed.
    pub async fn switch_deadline(&self, tip_id: u64) -> u64 {
        let deadline = self.tip_public(tip_id).await["switch_deadline"].clone();
        deadline
            .as_str()
            .unwrap_or_else(|| panic!("tip {tip_id} has no switch deadline: {deadline}"))
            .parse()
            .expect("switch_deadline is not a number")
    }

    pub async fn switch_triggered(&self, tip_id: u64) -> bool {
        self.tip_public(tip_id).await["switch_triggered"]
            .as_bool()
            .expect("switch_triggered is a bool")
    }

    /// Seal the given member list, as `post_released_keys` expects it.
    pub async fn post_keys(
        &self,
        who: &Account,
        tip_id: u64,
        members: &[&Account],
    ) -> Result<(), String> {
        let keys: Vec<serde_json::Value> = members
            .iter()
            .map(|member| {
                json!({
                    "member": member.id(),
                    "cid": format!("released-{}", member.id()),
                })
            })
            .collect();
        self.call(
            who,
            "post_released_keys",
            json!({ "tip_id": tip_id, "keys": keys }),
        )
        .await
    }

    /// The tip's status *variant name* — `"Submitted"`, `"UnderReview"`, `"Accepted"`, …
    ///
    /// `TipStatus` is serde externally tagged, so a unit variant arrives as a bare string and
    /// `Accepted` as `{"Accepted": {"reward": …}}`. Reading the name here instead of in each test
    /// keeps the assertion about the state machine separate from the JSON encoding of it.
    pub async fn tip_status(&self, tip_id: u64) -> String {
        match &self.tip_view(tip_id).await["status"] {
            serde_json::Value::String(name) => name.clone(),
            serde_json::Value::Object(fields) => fields
                .keys()
                .next()
                .cloned()
                .unwrap_or_else(|| panic!("a status object with no variant name")),
            other => panic!("unrecognised status shape: {other}"),
        }
    }

    /// The reward a tip was accepted at, in tUSDC base units. Panics unless it is `Accepted`.
    pub async fn accepted_reward(&self, tip_id: u64) -> u128 {
        let reward = &self.tip_view(tip_id).await["status"]["Accepted"]["reward"];
        reward
            .as_str()
            .unwrap_or_else(|| panic!("accepted reward is not a decimal string: {reward}"))
            .parse()
            .expect("accepted reward is not a number")
    }

    /// Mine a `pow_nonce` that clears `pow_bits` for this evidence hash, using the contract's own
    /// public `pow::check`. Needed when a test wants a submission that *passes* a real threshold.
    pub fn mine_pow(&self, evidence_hash: &[u8; 32], pow_bits: u8) -> u64 {
        // Expected work is 2^pow_bits; 64x that is a window a fair coin still cannot miss.
        let window = 64u64 << u64::from(pow_bits);
        (0..window)
            .find(|nonce| sealedtip::pow::check(evidence_hash, *nonce, pow_bits))
            .expect("no nonce in the search window — the PoW target is unreachable")
    }
}

/// `{"fund": id}`, the only message this contract accepts.
pub fn fund_msg(programme_id: u64) -> String {
    format!("{{\"fund\":{programme_id}}}")
}

/// 50 mNEAR in yoctoNEAR, as a decimal string — above `u64::MAX` a JSON number would lose digits.
pub const DRIP: &str = "5000000000000000000";

/// One submission, with the honest defaults a happy path wants and a field for each rule a negative
/// test breaks. `sealed` is the member list the key is sealed to; two entries is the minimum.
#[derive(Clone)]
pub struct Submission {
    pub programme_id: u64,
    pub evidence_hash: [u8; 32],
    pub sealed: Vec<AccountId>,
    pub recused: Vec<AccountId>,
    /// (interval ns, grace ns) — `None` means the tipster turned the switch off.
    pub switch: Option<(u64, u64)>,
    pub pow_nonce: u64,
    /// Sign with a different key, so the only rule left standing is E09.
    pub wrong_signer: bool,
}

impl Submission {
    pub fn new(programme_id: u64, member_1: &Account, member_2: &Account) -> Self {
        Self {
            programme_id,
            evidence_hash: [0x11; 32],
            sealed: vec![member_1.id().clone(), member_2.id().clone()],
            recused: vec![],
            switch: None,
            pow_nonce: 0,
            wrong_signer: false,
        }
    }
}

/// A named subaccount of the sandbox root, with its own deterministic key.
async fn account(root: &Account, name: &str) -> Account {
    root.create_subaccount(name)
        .keys(key(&format!("{name}.seed")))
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await
        .unwrap_or_else(|e| panic!("create {name} failed: {e}"))
        .into_result()
        .unwrap_or_else(|e| panic!("create {name} reverted: {}", e))
}

/// Create `name.test.near` and deploy the given contract wasm to it.
async fn deploy(root: &Account, name: &str, path: &str, built_by: &str) -> Contract {
    let account = account(root, name).await;
    let bytes = wasm(path, built_by);
    account
        .deploy(&bytes)
        .await
        .unwrap_or_else(|e| panic!("deploy {name} failed: {e}"))
        .into_result()
        .unwrap_or_else(|e| panic!("deploy {name} reverted: {}", e))
}

/// A yoctoNEAR amount as it arrives from RPC (a decimal string in a `U128`).
fn yocto(s: &str) -> NearToken {
    NearToken::from_yoctonear(
        s.parse::<u128>()
            .unwrap_or_else(|e| panic!("not a number {s:?}: {e}")),
    )
}
