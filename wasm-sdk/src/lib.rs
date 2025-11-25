//! Lendaswap Client SDK - WASM Bindings
//!
//! This crate provides WebAssembly bindings for the Lendaswap Client SDK.
//! It wraps the core library with WASM-compatible types and JavaScript interop.
//!
//! **Note:** This crate is WASM-only and will not compile for native targets.
//!
//! # Usage from JavaScript/TypeScript
//!
//! ```javascript
//! import init, { Wallet, JsWalletStorageProvider } from '@lendaswap/sdk';
//!
//! // Initialize WASM
//! await init();
//!
//! // Create wallet storage provider with typed callbacks
//! const walletStorage = new JsWalletStorageProvider(
//!     async () => localStorage.getItem('mnemonic'),
//!     async (mnemonic) => localStorage.setItem('mnemonic', mnemonic),
//!     async () => parseInt(localStorage.getItem('key_index') ?? '0'),
//!     async (index) => localStorage.setItem('key_index', index.toString())
//! );
//!
//! // Create wallet
//! const wallet = new Wallet(walletStorage, 'bitcoin');
//!
//! // Generate or get mnemonic
//! const mnemonic = await wallet.generate_or_get_mnemonic();
//!
//! // Derive swap parameters
//! const params = await wallet.derive_swap_params();
//! ```

// This crate only compiles for WASM targets
#![cfg(target_arch = "wasm32")]

mod client;
mod error;
mod js_types;
mod storage_adapter;

use serde::Serialize;
use wasm_bindgen::prelude::*;

pub use client::*;
pub use error::*;
pub use js_types::*;
pub use storage_adapter::*;

use lendaswap_core::api as core_api;

/// Initialize the WASM module.
///
/// This sets up logging and panic hooks for better debugging.
#[wasm_bindgen(start)]
pub fn initialize() {
    // Set up panic hook for better error messages
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    // Initialize logging
    console_log::init_with_level(log::Level::Debug).ok();
    log::info!("Lendaswap SDK initialized");
}

/// Serialize a value to JsValue as a plain object (not a Map).
fn to_js_value<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value
        .serialize(&serializer)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

// Re-export core API types with wasm_bindgen
// Note: For complex types, we create JS-friendly wrappers

/// Token identifier.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct TokenId(core_api::TokenId);

#[wasm_bindgen]
impl TokenId {
    #[wasm_bindgen(js_name = "btcLightning")]
    pub fn btc_lightning() -> TokenId {
        TokenId(core_api::TokenId::BtcLightning)
    }

    #[wasm_bindgen(js_name = "btcArkade")]
    pub fn btc_arkade() -> TokenId {
        TokenId(core_api::TokenId::BtcArkade)
    }

    #[wasm_bindgen(js_name = "usdcPol")]
    pub fn usdc_pol() -> TokenId {
        TokenId(core_api::TokenId::usdc_pol())
    }

    #[wasm_bindgen(js_name = "usdt0Pol")]
    pub fn usdt0_pol() -> TokenId {
        TokenId(core_api::TokenId::usdt0_pol())
    }

    #[wasm_bindgen(js_name = "usdcEth")]
    pub fn usdc_eth() -> TokenId {
        TokenId(core_api::TokenId::usdc_eth())
    }

    #[wasm_bindgen(js_name = "usdtEth")]
    pub fn usdt_eth() -> TokenId {
        TokenId(core_api::TokenId::usdt_eth())
    }

    #[wasm_bindgen(js_name = "toString")]
    pub fn to_js_string(&self) -> String {
        self.0.to_string()
    }

    #[wasm_bindgen(js_name = "fromString")]
    pub fn from_string(s: &str) -> Result<TokenId, JsValue> {
        match s {
            "btc_lightning" => Ok(TokenId(core_api::TokenId::BtcLightning)),
            "btc_arkade" => Ok(TokenId(core_api::TokenId::BtcArkade)),
            // All other tokens use the Coin variant
            other => Ok(TokenId(core_api::TokenId::Coin(other.to_string()))),
        }
    }
}

impl From<core_api::TokenId> for TokenId {
    fn from(t: core_api::TokenId) -> Self {
        TokenId(t)
    }
}

impl From<TokenId> for core_api::TokenId {
    fn from(t: TokenId) -> Self {
        t.0
    }
}

/// Version information.
#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct Version {
    pub tag: String,
    #[wasm_bindgen(js_name = "commitHash")]
    pub commit_hash: String,
}

impl From<core_api::Version> for Version {
    fn from(v: core_api::Version) -> Self {
        Version {
            tag: v.tag,
            commit_hash: v.commit_hash,
        }
    }
}
