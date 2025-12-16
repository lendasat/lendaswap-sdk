//! Integration tests for manual API testing.
//!
//! Run with: cargo test --test integration -- --nocapture --ignored

use lendaswap_core::api::{EvmChain, TokenId};
use lendaswap_core::{
    ApiClient, Client, ExtendedSwapStorageData, Network, StorageFuture, SwapStorage, WalletStorage,
};
use rust_decimal_macros::dec;
use std::collections::HashMap;
use std::sync::RwLock;

const API_URL: &str = "http://localhost:3333";

/// In-memory wallet storage implementation for integration tests.
#[derive(Default)]
pub struct InMemoryWalletStorage {
    mnemonic: RwLock<Option<String>>,
    key_index: RwLock<u32>,
}

impl InMemoryWalletStorage {
    pub fn new() -> Self {
        Self {
            mnemonic: RwLock::new(None),
            key_index: RwLock::new(0),
        }
    }
}

impl WalletStorage for InMemoryWalletStorage {
    fn get_mnemonic(&self) -> StorageFuture<'_, Option<String>> {
        Box::pin(async move {
            let mnemonic = self.mnemonic.read().unwrap();
            Ok(mnemonic.clone())
        })
    }

    fn set_mnemonic(&self, mnemonic: &str) -> StorageFuture<'_, ()> {
        let mnemonic = mnemonic.to_string();
        Box::pin(async move {
            let mut stored = self.mnemonic.write().unwrap();
            *stored = Some(mnemonic);
            Ok(())
        })
    }

    fn get_key_index(&self) -> StorageFuture<'_, u32> {
        Box::pin(async move {
            let index = self.key_index.read().unwrap();
            Ok(*index)
        })
    }

    fn set_key_index(&self, index: u32) -> StorageFuture<'_, ()> {
        Box::pin(async move {
            let mut stored = self.key_index.write().unwrap();
            *stored = index;
            Ok(())
        })
    }
}

/// In-memory swap storage implementation for integration tests.
#[derive(Default)]
pub struct InMemorySwapStorage {
    data: RwLock<HashMap<String, ExtendedSwapStorageData>>,
}

impl InMemorySwapStorage {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

impl SwapStorage for InMemorySwapStorage {
    fn get(&self, swap_id: &str) -> StorageFuture<'_, Option<ExtendedSwapStorageData>> {
        let swap_id = swap_id.to_string();
        Box::pin(async move {
            let data = self.data.read().unwrap();
            Ok(data.get(&swap_id).cloned())
        })
    }

    fn store(&self, swap_id: &str, data: &ExtendedSwapStorageData) -> StorageFuture<'_, ()> {
        let swap_id = swap_id.to_string();
        let data = data.clone();
        Box::pin(async move {
            let mut storage = self.data.write().unwrap();
            storage.insert(swap_id, data);
            Ok(())
        })
    }

    fn delete(&self, swap_id: &str) -> StorageFuture<'_, ()> {
        let swap_id = swap_id.to_string();
        Box::pin(async move {
            let mut data = self.data.write().unwrap();
            data.remove(&swap_id);
            Ok(())
        })
    }

    fn list(&self) -> StorageFuture<'_, Vec<String>> {
        Box::pin(async move {
            let data = self.data.read().unwrap();
            Ok(data.keys().cloned().collect())
        })
    }

    fn get_all(&self) -> StorageFuture<'_, Vec<ExtendedSwapStorageData>> {
        Box::pin(async move {
            let data = self.data.read().unwrap();
            Ok(data.values().cloned().collect())
        })
    }
}

#[tokio::test]
#[ignore] // Run manually with: cargo test --test integration test_create_arkade_to_evm_swap -- --nocapture --ignored
async fn test_create_arkade_to_evm_swap() {
    let wallet_storage = InMemoryWalletStorage::new();
    let swap_storage = InMemorySwapStorage::new();

    let client = Client::new(
        API_URL,
        wallet_storage,
        swap_storage,
        Network::Bitcoin,
        "https://arkade.computer".to_string(),
    );

    // we need to ensure there is a mnemonic
    client.init(None).await.unwrap();

    let swap = client
        .create_evm_to_arkade_swap(
            "ark1qq4hfssprtcgnjzf8qlw2f78yvjau5kldfugg29k34y7j96q2w4t4yshsdtvetdshwurx3k45r75hkljgyghxm7v5eqwpdugng8twek5qmvjlk".to_string(),
            "0xC4323499B809fa8bF421970D9662D37804F23852".to_string(),
            dec!(1),
            TokenId::Coin("usdc_pol".to_string()),
            EvmChain::Polygon,
            None,
        )
        .await
        .unwrap();

    dbg!(swap);
}

#[tokio::test]
#[ignore]
async fn test_health_check() {
    let client = ApiClient::new(API_URL);

    match client.health_check().await {
        Ok(response) => println!("Health check: {}", response),
        Err(e) => println!("Health check failed: {:#}", e),
    }
}

#[tokio::test]
#[ignore]
async fn test_get_tokens() {
    let client = ApiClient::new(API_URL);

    match client.get_tokens().await {
        Ok(tokens) => {
            println!("Available tokens:");
            for token in tokens {
                println!("  - {} ({:?})", token.symbol, token.token_id);
            }
        }
        Err(e) => println!("Failed to get tokens: {:#}", e),
    }
}

#[tokio::test]
#[ignore]
async fn test_get_asset_pairs() {
    let client = ApiClient::new(API_URL);

    match client.get_asset_pairs().await {
        Ok(pairs) => {
            println!("Available asset pairs:");
            for pair in pairs {
                println!("  - {} -> {}", pair.source.symbol, pair.target.symbol);
            }
        }
        Err(e) => println!("Failed to get asset pairs: {:#}", e),
    }
}

#[tokio::test]
#[ignore]
async fn test_get_quote() {
    use lendaswap_core::api::QuoteRequest;

    let client = ApiClient::new(API_URL);

    let request = QuoteRequest {
        from: TokenId::BtcArkade,
        to: TokenId::Coin("USDC_POL".to_string()),
        base_amount: 100_000, // 100,000 sats
    };

    match client.get_quote(&request).await {
        Ok(quote) => {
            println!("Quote received:");
            println!("  Exchange rate: {}", quote.exchange_rate);
            println!("  Network fee: {}", quote.network_fee);
            println!("  Protocol fee: {}", quote.protocol_fee);
            println!("  Min amount: {}", quote.min_amount);
            println!("  Max amount: {}", quote.max_amount);
        }
        Err(e) => println!("Failed to get quote: {:#}", e),
    }
}

#[tokio::test]
#[ignore]
async fn test_get_swap() {
    use lendaswap_core::api::GetSwapResponse;

    let client = ApiClient::new(API_URL);

    let swap_id = "your-swap-id-here";

    match client.get_swap(swap_id).await {
        Ok(swap) => {
            println!("Swap details:");
            match swap {
                GetSwapResponse::BtcToEvm(s) => {
                    println!("  Direction: BTC -> EVM");
                    println!("  ID: {}", s.common.id);
                    println!("  Status: {:?}", s.common.status);
                }
                GetSwapResponse::EvmToBtc(s) => {
                    println!("  Direction: EVM -> BTC");
                    println!("  ID: {}", s.common.id);
                    println!("  Status: {:?}", s.common.status);
                }
            }
        }
        Err(e) => println!("Failed to get swap: {:#}", e),
    }
}

#[tokio::test]
#[ignore]
async fn test_get_version() {
    let client = ApiClient::new(API_URL);

    match client.get_version().await {
        Ok(version) => {
            println!("API Version:");
            println!("  Tag: {}", version.tag);
            println!("  Commit: {}", version.commit_hash);
        }
        Err(e) => println!("Failed to get version: {:#}", e),
    }
}

// ============================================================================
// VTXO Swap E2E Tests
// ============================================================================

const ARKADE_URL: &str = "http://localhost:7070";

#[tokio::test]
#[ignore] // Run manually: cargo test --test integration test_vtxo_swap_estimate -- --nocapture --ignored
async fn test_vtxo_swap_estimate() {
    let client = ApiClient::new(API_URL);

    // Use test outpoints - these should be real VTXOs in your test environment
    let vtxos =
        vec!["0000000000000000000000000000000000000000000000000000000000000001:0".to_string()];

    match client.estimate_vtxo_swap(vtxos).await {
        Ok(estimate) => {
            println!("VTXO Swap Estimate:");
            println!("  Fee: {} sats", estimate.fee_sats);
            println!("  Total input: {} sats", estimate.total_input_sats);
            println!("  Output: {} sats", estimate.output_sats);
            println!("  VTXO count: {}", estimate.vtxo_count);
        }
        Err(e) => println!("Failed to estimate VTXO swap: {:#}", e),
    }
}

#[tokio::test]
#[ignore] // Run manually: cargo test --test integration test_vtxo_swap_create -- --nocapture --ignored
async fn test_vtxo_swap_create() {
    let wallet_storage = InMemoryWalletStorage::new();
    let swap_storage = InMemorySwapStorage::new();

    let client = Client::new(
        API_URL,
        wallet_storage,
        swap_storage,
        Network::Mutinynet,
        ARKADE_URL.to_string(),
    );

    // Initialize wallet with a test mnemonic
    client.init(None).await.expect("Failed to init wallet");

    // Use test outpoints - these should be real VTXOs in your test environment
    let vtxos =
        vec!["0000000000000000000000000000000000000000000000000000000000000001:0".to_string()];

    match client.create_vtxo_swap(vtxos).await {
        Ok((swap, swap_params)) => {
            println!("VTXO Swap Created:");
            println!("  ID: {}", swap.id);
            println!("  Status: {:?}", swap.status);
            println!("  Client VHTLC: {}", swap.client_vhtlc_address);
            println!(
                "  Client fund amount: {} sats",
                swap.client_fund_amount_sats
            );
            println!("  Server VHTLC: {}", swap.server_vhtlc_address);
            println!(
                "  Server fund amount: {} sats",
                swap.server_fund_amount_sats
            );
            println!("  Fee: {} sats", swap.fee_sats);
            println!("  Client locktime: {}", swap.client_locktime);
            println!("  Server locktime: {}", swap.server_locktime);
            println!("  Preimage hash: {}", swap.preimage_hash);
            println!("\nSwap Params (client stores these for claiming):");
            println!("  Key index: {}", swap_params.key_index);
            println!("  Preimage: 0x{}", hex::encode(swap_params.preimage));
        }
        Err(e) => println!("Failed to create VTXO swap: {:#}", e),
    }
}

#[tokio::test]
#[ignore] // Run manually: cargo test --test integration test_vtxo_swap_get -- --nocapture --ignored
async fn test_vtxo_swap_get() {
    let client = ApiClient::new(API_URL);

    let swap_id = "your-vtxo-swap-id-here";

    match client.get_vtxo_swap(swap_id).await {
        Ok(swap) => {
            println!("VTXO Swap Details:");
            println!("  ID: {}", swap.id);
            println!("  Status: {:?}", swap.status);
            println!("  Client VHTLC: {}", swap.client_vhtlc_address);
            println!("  Server VHTLC: {}", swap.server_vhtlc_address);
            println!("  Fee: {} sats", swap.fee_sats);
        }
        Err(e) => println!("Failed to get VTXO swap: {:#}", e),
    }
}

/// Full E2E test for VTXO swap happy path.
///
/// This test requires:
/// 1. Running Lendaswap server at localhost:3333
/// 2. Running Arkade server at localhost:7070
/// 3. Client has VTXOs to refresh
///
/// Steps:
/// 1. Create VTXO swap (client gets addresses)
/// 2. Fund client's VHTLC manually (use ark-cli send)
/// 3. Wait for server to fund
/// 4. Claim server's VHTLC
#[tokio::test]
#[ignore] // Run manually: cargo test --test integration test_vtxo_swap_e2e_happy_path -- --nocapture --ignored
async fn test_vtxo_swap_e2e_happy_path() {
    use lendaswap_core::api::VtxoSwapStatus;

    let wallet_storage = InMemoryWalletStorage::new();
    let swap_storage = InMemorySwapStorage::new();

    let client = Client::new(
        API_URL,
        wallet_storage,
        swap_storage,
        Network::Mutinynet,
        ARKADE_URL.to_string(),
    );

    // Initialize wallet
    client.init(None).await.expect("Failed to init wallet");

    // Step 1: Create VTXO swap
    // Replace with actual VTXO outpoints from your test environment
    let vtxos = vec!["replace_with_real_txid:0".to_string()];

    println!("Step 1: Creating VTXO swap...");
    let (swap, swap_params) = client
        .create_vtxo_swap(vtxos)
        .await
        .expect("Failed to create swap");
    println!("  Swap ID: {}", swap.id);
    println!("  Client VHTLC address: {}", swap.client_vhtlc_address);
    println!(
        "  Client should fund: {} sats",
        swap.client_fund_amount_sats
    );

    // Step 2: Fund client's VHTLC
    // This needs to be done manually using ark-cli:
    // ark-cli send --to <client_vhtlc_address> --amount <amount>
    println!("\nStep 2: Fund client's VHTLC manually:");
    println!(
        "  ark-cli send --to {} --amount {}",
        swap.client_vhtlc_address, swap.client_fund_amount_sats
    );
    println!("  Press Enter after funding...");

    // In a real test, you'd wait for user input or automate the funding
    // For now, we'll poll the API waiting for status change

    // Step 3: Wait for server to fund
    println!("\nStep 3: Waiting for server to fund...");
    loop {
        let updated_swap = client
            .get_vtxo_swap(&swap.id.to_string())
            .await
            .expect("Failed to get swap");
        println!("  Current status: {:?}", updated_swap.status);

        if updated_swap.status == VtxoSwapStatus::ServerFunded {
            println!("  Server funded! Ready to claim.");
            break;
        }

        if updated_swap.status == VtxoSwapStatus::Expired {
            panic!("Swap expired!");
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }

    // Step 4: Claim server's VHTLC
    println!("\nStep 4: Claiming server's VHTLC...");

    // Get a claim address - in real use, this would be the user's Arkade address
    let claim_address = "ark1qq..."; // Replace with actual address

    let txid = client
        .claim_vtxo_swap(&swap, swap_params, claim_address)
        .await
        .expect("Failed to claim");

    println!("  Claimed! Transaction: {}", txid);

    // Step 5: Wait for completion
    println!("\nStep 5: Waiting for swap completion...");
    loop {
        let final_swap = client
            .get_vtxo_swap(&swap.id.to_string())
            .await
            .expect("Failed to get swap");
        println!("  Current status: {:?}", final_swap.status);

        if final_swap.status == VtxoSwapStatus::ServerRedeemed {
            println!("\n✅ VTXO swap completed successfully!");
            break;
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}
