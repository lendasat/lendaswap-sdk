//! Async storage abstraction for platform-agnostic wallet persistence.
//!
//! This module defines storage traits that allow the wallet to work
//! with any storage backend (localStorage, IndexedDB, filesystem, etc.).
//!
//! There are two separate storage concerns:
//! - `WalletStorage`: Typed storage for wallet data (mnemonic, key index)
//! - `SwapStorage`: Typed storage specifically for swap data

use crate::client::ExtendedSwapStorageData;
use crate::error::Result;
use std::future::Future;
use std::pin::Pin;

/// Type alias for storage futures.
///
/// On WASM targets, futures don't need to be `Send` since JavaScript is single-threaded.
/// On native targets, futures should be `Send` to allow use with multi-threaded runtimes.
#[cfg(target_arch = "wasm32")]
pub type StorageFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + 'a>>;

#[cfg(not(target_arch = "wasm32"))]
pub type StorageFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

/// Typed storage trait for wallet data (mnemonic and key index).
///
/// This trait provides an opinionated API for storing wallet credentials.
/// Unlike a generic key-value store, this works with specific wallet data types,
/// making the API clearer and type-safe.
///
/// # Example Implementation (TypeScript/Dexie)
///
/// ```typescript
/// // In TypeScript, implement this as callbacks passed to the WASM SDK:
/// const walletStorage = new JsWalletStorageProvider(
///     async () => localStorage.getItem('mnemonic'),           // get_mnemonic
///     async (mnemonic) => localStorage.setItem('mnemonic', mnemonic), // set_mnemonic
///     async () => parseInt(localStorage.getItem('key_index') ?? '0'), // get_key_index
///     async (index) => localStorage.setItem('key_index', index.toString()), // set_key_index
/// );
/// ```
#[cfg(target_arch = "wasm32")]
pub trait WalletStorage {
    /// Get the mnemonic phrase from storage.
    ///
    /// Returns `Ok(None)` if no mnemonic has been stored.
    fn get_mnemonic(&self) -> StorageFuture<'_, Option<String>>;

    /// Store the mnemonic phrase.
    ///
    /// Overwrites any existing mnemonic.
    fn set_mnemonic(&self, mnemonic: &str) -> StorageFuture<'_, ()>;

    /// Get the current key derivation index.
    ///
    /// Returns `Ok(0)` if not set.
    fn get_key_index(&self) -> StorageFuture<'_, u32>;

    /// Set the key derivation index.
    fn set_key_index(&self, index: u32) -> StorageFuture<'_, ()>;
}

#[cfg(not(target_arch = "wasm32"))]
pub trait WalletStorage: Send + Sync {
    /// Get the mnemonic phrase from storage.
    ///
    /// Returns `Ok(None)` if no mnemonic has been stored.
    fn get_mnemonic(&self) -> StorageFuture<'_, Option<String>>;

    /// Store the mnemonic phrase.
    ///
    /// Overwrites any existing mnemonic.
    fn set_mnemonic(&self, mnemonic: &str) -> StorageFuture<'_, ()>;

    /// Get the current key derivation index.
    ///
    /// Returns `Ok(0)` if not set.
    fn get_key_index(&self) -> StorageFuture<'_, u32>;

    /// Set the key derivation index.
    fn set_key_index(&self, index: u32) -> StorageFuture<'_, ()>;
}

/// Extension trait for wallet storage operations.
///
/// This provides convenience methods built on top of the base WalletStorage trait.
/// It's automatically implemented for any type that implements `WalletStorage`.
pub trait WalletStorageExt: WalletStorage {
    /// Increment and return the current key index (for auto-derivation).
    ///
    /// Returns the index to use (before incrementing).
    fn increment_key_index(&self) -> StorageFuture<'_, u32> {
        Box::pin(async move {
            let current = self.get_key_index().await?;
            let next = current + 1;
            self.set_key_index(next).await?;
            Ok(current)
        })
    }
}

// Blanket implementation for all WalletStorage types
impl<T: WalletStorage + ?Sized> WalletStorageExt for T {}

/// Typed storage trait for swap data.
///
/// This trait provides an opinionated API for storing and retrieving swap data.
/// Unlike the generic `Storage` trait, this works directly with `ExtendedSwapStorageData`
/// objects, allowing implementations to store them efficiently (e.g., as objects in IndexedDB).
///
/// # Example Implementation (TypeScript/Dexie)
///
/// ```typescript
/// // In TypeScript, implement this as callbacks passed to the WASM SDK:
/// const swapStorage = new JsSwapStorageProvider(
///     async (swapId) => await db.swaps.get(swapId),           // get
///     async (swapId, data) => await db.swaps.put(data, swapId), // store
///     async (swapId) => await db.swaps.delete(swapId),        // delete
///     async () => await db.swaps.toCollection().primaryKeys() // list
/// );
/// ```
#[cfg(target_arch = "wasm32")]
pub trait SwapStorage {
    /// Get swap data by swap ID.
    ///
    /// Returns `Ok(None)` if the swap doesn't exist.
    fn get(&self, swap_id: &str) -> StorageFuture<'_, Option<ExtendedSwapStorageData>>;

    /// Store swap data.
    ///
    /// Overwrites any existing swap with the same ID.
    fn store(&self, swap_id: &str, data: &ExtendedSwapStorageData) -> StorageFuture<'_, ()>;

    /// Delete swap data by swap ID.
    ///
    /// Does nothing if the swap doesn't exist.
    fn delete(&self, swap_id: &str) -> StorageFuture<'_, ()>;

    /// List all stored swap IDs.
    fn list(&self) -> StorageFuture<'_, Vec<String>>;

    /// Get all stored swaps.
    fn get_all(&self) -> StorageFuture<'_, Vec<ExtendedSwapStorageData>>;
}

#[cfg(not(target_arch = "wasm32"))]
pub trait SwapStorage: Send + Sync {
    /// Get swap data by swap ID.
    ///
    /// Returns `Ok(None)` if the swap doesn't exist.
    fn get(&self, swap_id: &str) -> StorageFuture<'_, Option<ExtendedSwapStorageData>>;

    /// Store swap data.
    ///
    /// Overwrites any existing swap with the same ID.
    fn store(&self, swap_id: &str, data: &ExtendedSwapStorageData) -> StorageFuture<'_, ()>;

    /// Delete swap data by swap ID.
    ///
    /// Does nothing if the swap doesn't exist.
    fn delete(&self, swap_id: &str) -> StorageFuture<'_, ()>;

    /// List all stored swap IDs.
    fn list(&self) -> StorageFuture<'_, Vec<String>>;

    /// Get all stored swaps.
    fn get_all(&self) -> StorageFuture<'_, Vec<ExtendedSwapStorageData>>;
}

/// In-memory wallet storage implementation for testing.
#[cfg(test)]
pub mod memory {
    use super::*;
    use std::sync::RwLock;

    /// Simple in-memory wallet storage for testing purposes.
    pub struct MemoryWalletStorage {
        mnemonic: RwLock<Option<String>>,
        key_index: RwLock<u32>,
    }

    impl MemoryWalletStorage {
        /// Create a new empty memory wallet storage.
        pub fn new() -> Self {
            Self {
                mnemonic: RwLock::new(None),
                key_index: RwLock::new(0),
            }
        }
    }

    impl Default for MemoryWalletStorage {
        fn default() -> Self {
            Self::new()
        }
    }

    impl WalletStorage for MemoryWalletStorage {
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
}
