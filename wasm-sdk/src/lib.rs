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
//! import init, { Wallet, JsWalletStorageProvider } from '@lendasat/lendaswap-sdk';
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
/// Log level can be configured via localStorage key "lendaswap_log_level".
/// Valid values: "trace", "debug", "info", "warn", "error" (case-insensitive).
/// Default is "warn" if not set or invalid.
#[wasm_bindgen(start)]
pub fn initialize() {
    // Set up panic hook for better error messages
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    // Initialize logging with level from localStorage
    let log_level = get_log_level_from_storage();
    console_log::init_with_level(log_level).ok();
    log::info!("Lendaswap SDK initialized with log level: {:?}", log_level);
}

/// Get log level from localStorage.
/// Reads "lendaswap_log_level" key and parses it.
/// Returns Warn if not set or invalid.
fn get_log_level_from_storage() -> log::Level {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return log::Level::Warn,
    };

    let storage = match window.local_storage() {
        Ok(Some(s)) => s,
        _ => return log::Level::Warn,
    };

    let level_str = match storage.get_item("lendaswap_log_level") {
        Ok(Some(s)) => s,
        _ => return log::Level::Warn,
    };

    match level_str.to_lowercase().as_str() {
        "trace" => log::Level::Trace,
        "debug" => log::Level::Debug,
        "info" => log::Level::Info,
        "warn" => log::Level::Warn,
        "error" => log::Level::Error,
        _ => log::Level::Warn,
    }
}

/// Set the log level at runtime.
/// This updates localStorage and reinitializes the logger.
///
/// Valid values: "trace", "debug", "info", "warn", "error" (case-insensitive).
#[wasm_bindgen(js_name = "setLogLevel")]
pub fn set_log_level(level: &str) -> Result<(), JsValue> {
    let log_level = match level.to_lowercase().as_str() {
        "trace" => log::Level::Trace,
        "debug" => log::Level::Debug,
        "info" => log::Level::Info,
        "warn" => log::Level::Warn,
        "error" => log::Level::Error,
        _ => {
            return Err(JsValue::from_str(
                "Invalid log level. Use: trace, debug, info, warn, error",
            ));
        }
    };

    // Store in localStorage for persistence
    if let Some(window) = web_sys::window() {
        if let Ok(Some(storage)) = window.local_storage() {
            storage
                .set_item("lendaswap_log_level", level)
                .map_err(|e| JsValue::from_str(&format!("Failed to save log level: {:?}", e)))?;
        }
    }

    // Update the max log level filter
    log::set_max_level(log_level.to_level_filter());
    log::info!("Log level changed to: {:?}", log_level);

    Ok(())
}

/// Get the current log level.
#[wasm_bindgen(js_name = "getLogLevel")]
pub fn get_log_level() -> String {
    match log::max_level() {
        log::LevelFilter::Trace => "trace".to_string(),
        log::LevelFilter::Debug => "debug".to_string(),
        log::LevelFilter::Info => "info".to_string(),
        log::LevelFilter::Warn => "warn".to_string(),
        log::LevelFilter::Error => "error".to_string(),
        log::LevelFilter::Off => "off".to_string(),
    }
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
