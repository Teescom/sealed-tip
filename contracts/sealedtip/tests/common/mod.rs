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

use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
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
    pub tipster: SecretKey,
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
            tipster: key("tipster.seed"),
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
        let raw = self.tipster.public_key().key_data().to_vec();
        raw.try_into().expect("ed25519 public key is not 32 bytes")
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
