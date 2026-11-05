//! tUSDC mock token for testnet and sandbox only (A-1.5).
//! NEP-141 (core + transfer-call resolver), NEP-145 (storage) and NEP-148 (metadata) via
//! `near-contract-standards` (approved 2026-11-04), plus open `mint`.
//!
//! `mint` is deliberately unauthenticated: this contract never goes to mainnet. It also registers
//! accounts for free, so a demo can fund a fresh wallet in one call instead of a two-step
//! `storage_deposit` + `mint`.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

/// 6 decimals, matching the USDC the tipsters are paid in on mainnet.
const DECIMALS: u8 = 6;
const ERR_MINT_NOT_POSITIVE: &str = "Mint amount must be positive";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
}

#[near]
impl MockFt {
    #[init]
    pub fn new() -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Testnet USDC".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        };
        metadata.assert_valid();
        Self {
            token: FungibleToken::new(b"t".to_vec()),
            metadata,
        }
    }

    /// Open mint — testnet only.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(amount.0 > 0, ERR_MINT_NOT_POSITIVE);
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount,
            memo: None,
        }
        .emit();
    }
}

#[near]
impl FungibleTokenCore for MockFt {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockFt {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .internal_ft_resolve_transfer(&sender_id, receiver_id, amount)
            .0
            .into()
    }
}

#[near]
impl StorageManagement for MockFt {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockFt {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::{testing_env, NearToken, PromiseOrValue};

    /// 1 tUSDC = 10^6 base units (decimals 6, like USDC).
    const UNIT: u128 = 1_000_000;

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn alice() -> AccountId {
        account("alice.testnet")
    }
    fn bob() -> AccountId {
        account("bob.testnet")
    }
    fn carol() -> AccountId {
        account("carol.testnet")
    }
    fn sealedtip() -> AccountId {
        account("sealedtip.testnet")
    }

    /// The contract is always `tusdc.testnet`; only the caller and the attached deposit vary.
    fn set_context(caller: AccountId, attached_deposit: NearToken) {
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(account("tusdc.testnet"))
            .signer_account_id(caller.clone())
            .predecessor_account_id(caller)
            .attached_deposit(attached_deposit);
        testing_env!(context.build());
    }

    /// Deploy under a valid context so `FungibleToken::new` can measure per-account storage cost.
    fn deploy() -> MockFt {
        set_context(alice(), NearToken::from_near(0));
        MockFt::new()
    }

    fn mint(ft: &mut MockFt, to: AccountId, units: u128) {
        set_context(alice(), NearToken::from_near(0));
        ft.mint(to, U128(units * UNIT));
    }

    /// NEP-141 mutating calls carry exactly 1 yoctoNEAR.
    fn transfer(ft: &mut MockFt, from: AccountId, to: AccountId, units: u128) {
        set_context(from, NearToken::from_yoctonear(1));
        ft.ft_transfer(to, U128(units * UNIT), None);
    }

    fn balance(ft: &MockFt, who: AccountId) -> u128 {
        ft.ft_balance_of(who).0
    }

    /// The `EVENT_JSON` payload for `name`. The mock VM keeps log lines from earlier calls in the
    /// same test, so each assertion picks out its own event; NEP-141 names them `ft_mint`,
    /// `ft_transfer`, `ft_burn`.
    fn logged_event(name: &str) -> String {
        let mut found = get_logs()
            .iter()
            .filter_map(|line| line.strip_prefix("EVENT_JSON:"))
            .filter(|payload| payload.contains(&format!("\"event\":\"{name}\"")))
            .map(<str>::to_string)
            .collect::<Vec<String>>();
        assert_eq!(
            found.len(),
            1,
            "expected exactly one {name} event, got {found:?}"
        );
        found.pop().unwrap()
    }

    /// `internal_register_account` stands in for a paid `storage_deposit` in tests that only
    /// need the receiver to exist.
    fn register(ft: &mut MockFt, who: AccountId) {
        ft.token.internal_register_account(&who);
    }

    #[test]
    fn minting_credits_a_fresh_account_without_a_storage_deposit() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 10);
        assert_eq!(balance(&ft, alice()), 10 * UNIT);
        assert_eq!(ft.ft_total_supply().0, 10 * UNIT);
    }

    #[test]
    fn repeated_mints_accumulate_on_one_balance_and_one_supply() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 4);
        mint(&mut ft, alice(), 6);
        mint(&mut ft, bob(), 1);
        assert_eq!(balance(&ft, alice()), 10 * UNIT);
        assert_eq!(ft.ft_total_supply().0, 11 * UNIT);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn minting_zero_is_rejected() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 0);
    }

    #[test]
    #[should_panic(expected = "Balance overflow")]
    fn minting_past_the_maximum_panics_instead_of_wrapping() {
        let mut ft = deploy();
        set_context(alice(), NearToken::from_near(0));
        ft.mint(alice(), U128(u128::MAX));
        ft.mint(alice(), U128(1));
    }

    #[test]
    fn minting_emits_a_nep141_mint_event() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 10);
        let event = logged_event("ft_mint");
        assert!(event.contains("\"standard\":\"nep141\""), "{event}");
        assert!(event.contains("\"version\":\"1.0.0\""), "{event}");
        assert!(event.contains("alice.testnet"), "{event}");
        assert!(event.contains(&(10 * UNIT).to_string()), "{event}");
    }

    #[test]
    fn transferring_moves_balance_and_leaves_supply_unchanged() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 10);
        register(&mut ft, bob());
        transfer(&mut ft, alice(), bob(), 4);
        assert_eq!(balance(&ft, alice()), 6 * UNIT);
        assert_eq!(balance(&ft, bob()), 4 * UNIT);
        assert_eq!(ft.ft_total_supply().0, 10 * UNIT);
    }

    #[test]
    fn unregistered_accounts_have_a_zero_balance() {
        let ft = deploy();
        assert_eq!(balance(&ft, carol()), 0);
    }

    #[test]
    fn transferring_emits_one_nep141_event() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 10);
        register(&mut ft, bob());
        transfer(&mut ft, alice(), bob(), 4);
        let event = logged_event("ft_transfer");
        assert!(event.contains("\"standard\":\"nep141\""), "{event}");
        assert!(
            event.contains("alice.testnet") && event.contains("bob.testnet"),
            "{event}"
        );
        assert!(event.contains(&(4 * UNIT).to_string()), "{event}");
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn transferring_without_a_deposit_is_rejected() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 10);
        register(&mut ft, bob());
        set_context(alice(), NearToken::from_near(0));
        ft.ft_transfer(bob(), U128(UNIT), None);
    }

    #[test]
    #[should_panic(expected = "The account bob.testnet is not registered")]
    fn transferring_to_an_unregistered_account_is_rejected() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 10);
        transfer(&mut ft, alice(), bob(), 4);
    }

    #[test]
    #[should_panic(expected = "The amount should be a positive number")]
    fn transferring_zero_is_rejected() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 10);
        register(&mut ft, bob());
        transfer(&mut ft, alice(), bob(), 0);
    }

    #[test]
    #[should_panic(expected = "Sender and receiver should be different")]
    fn transferring_to_yourself_is_rejected() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 10);
        transfer(&mut ft, alice(), alice(), 4);
    }

    #[test]
    #[should_panic(expected = "The account doesn't have enough balance")]
    fn transferring_more_than_the_balance_is_rejected() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 3);
        register(&mut ft, bob());
        transfer(&mut ft, alice(), bob(), 4);
    }

    #[test]
    fn storage_deposit_at_the_minimum_registers_the_account() {
        let mut ft = deploy();
        let min = ft.storage_balance_bounds().min;
        assert!(min > NearToken::from_near(0));
        set_context(bob(), min);
        let storage = ft.storage_deposit(None, None);
        assert_eq!(storage.total, min);
        assert_eq!(storage.available, NearToken::from_near(0));
        assert_eq!(ft.storage_balance_of(bob()).unwrap().total, min);
        assert_eq!(balance(&ft, bob()), 0);
    }

    #[test]
    #[should_panic(expected = "The attached deposit is less than the minimum storage balance")]
    fn storage_deposit_below_the_minimum_is_rejected() {
        let mut ft = deploy();
        set_context(bob(), NearToken::from_near(0));
        ft.storage_deposit(None, None);
    }

    #[test]
    fn storage_balance_of_is_none_until_the_account_registers() {
        let ft = deploy();
        assert!(ft.storage_balance_of(carol()).is_none());
    }

    #[test]
    fn metadata_describes_tusdc() {
        let ft = deploy();
        let metadata = ft.ft_metadata();
        assert_eq!(metadata.spec.as_str(), "ft-1.0.0");
        assert_eq!(metadata.symbol, "tUSDC");
        assert_eq!(metadata.decimals, 6);
        metadata.assert_valid();
    }

    #[test]
    fn transfer_call_credits_the_receiver_before_returning() {
        let mut ft = deploy();
        mint(&mut ft, alice(), 10);
        register(&mut ft, sealedtip());
        set_context(alice(), NearToken::from_yoctonear(1));
        let result = ft.ft_transfer_call(
            sealedtip(),
            U128(5 * UNIT),
            None,
            r#"{"fund":1}"#.to_string(),
        );
        assert!(matches!(result, PromiseOrValue::Promise(_)));
        assert_eq!(balance(&ft, alice()), 5 * UNIT);
        assert_eq!(balance(&ft, sealedtip()), 5 * UNIT);
    }
}
