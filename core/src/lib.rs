//! Lendaswap Client SDK - Core Library
//!
//! Platform-agnostic wallet functionality for HD key derivation and VHTLC operations.
//!
//! This crate provides the core wallet logic that can be used in both native Rust
//! applications and WebAssembly environments. Storage is abstracted through traits
//! that can be implemented for any backend (localStorage, IndexedDB, filesystem, etc.).
//!
//! # Example
//!
//! ```rust,ignore
//! use lendaswap_core::{Wallet, WalletStorage, Network};
//!
//! // Create a wallet with your storage implementation
//! let wallet = Wallet::new(my_wallet_storage, Network::Bitcoin);
//!
//! // Generate or retrieve mnemonic
//! let mnemonic = wallet.generate_or_get_mnemonic().await?;
//!
//! // Derive swap parameters
//! let params = wallet.derive_swap_params().await?;
//! ```

pub mod api;
pub mod client;
pub mod error;
pub mod hd_wallet;
pub mod storage;
pub mod types;
pub mod vhtlc;
pub mod wallet;

pub use api::ApiClient;
pub use client::{Client, ExtendedSwapStorageData};
pub use error::{Error, Result};
pub use hd_wallet::HdWallet;
pub use storage::{StorageFuture, SwapStorage, WalletStorage, WalletStorageExt};
pub use types::{Network, SwapParams, VhtlcAmounts};
pub use wallet::Wallet;
