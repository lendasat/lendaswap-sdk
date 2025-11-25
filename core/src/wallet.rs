//! Main wallet struct with dependency-injected storage.
//!
//! This module provides the high-level wallet API that combines HD key derivation
//! and VHTLC operations with pluggable storage.

use crate::error::{Error, Result};
use crate::hd_wallet::HdWallet;
use crate::storage::{WalletStorage, WalletStorageExt};
use crate::types::{Network, SwapParams};

/// Main wallet struct with injected storage.
///
/// The wallet is generic over the storage implementation, allowing it to work
/// with any backend (localStorage, IndexedDB, filesystem, etc.).
///
/// # Example
///
/// ```rust,ignore
/// use lendaswap_core::{Wallet, Network};
///
/// let wallet = Wallet::new(my_storage, Network::Bitcoin);
/// let mnemonic = wallet.generate_or_get_mnemonic().await?;
/// let params = wallet.derive_swap_params().await?;
/// ```
pub struct Wallet<S: WalletStorage> {
    storage: S,
    network: Network,
}

impl<S: WalletStorage> Wallet<S> {
    /// Create a new wallet with the given storage provider.
    pub fn new(storage: S, network: Network) -> Self {
        Self { storage, network }
    }

    /// Get the network this wallet is configured for.
    pub fn network(&self) -> Network {
        self.network
    }

    /// Get a reference to the storage provider.
    pub fn storage(&self) -> &S {
        &self.storage
    }

    /// Generate a new mnemonic or return existing one from storage.
    ///
    /// If a mnemonic already exists in storage, it is returned.
    /// Otherwise, a new 12-word mnemonic is generated and stored.
    pub async fn generate_or_get_mnemonic(&self) -> Result<String> {
        if let Some(mnemonic) = self.storage.get_mnemonic().await? {
            return Ok(mnemonic);
        }

        let wallet = HdWallet::generate(self.network.to_bitcoin_network(), 12)?;
        let mnemonic = wallet.mnemonic_phrase();
        self.storage.set_mnemonic(&mnemonic).await?;

        Ok(mnemonic)
    }

    /// Get the stored mnemonic (for backup display).
    ///
    /// Returns `None` if no mnemonic has been generated or imported.
    pub async fn get_mnemonic(&self) -> Result<Option<String>> {
        self.storage.get_mnemonic().await
    }

    /// Import a mnemonic phrase (replaces existing).
    ///
    /// The mnemonic is validated before being stored.
    pub async fn import_mnemonic(&self, phrase: &str) -> Result<()> {
        // Validate by creating wallet
        let _wallet = HdWallet::from_mnemonic(phrase, self.network.to_bitcoin_network())?;
        self.storage.set_mnemonic(phrase).await?;
        // Reset key index when importing new mnemonic
        self.storage.set_key_index(0).await?;
        Ok(())
    }

    /// Derive swap parameters for a new swap (increments index).
    ///
    /// This automatically increments the key derivation index after deriving.
    pub async fn derive_swap_params(&self) -> Result<SwapParams> {
        let index = self.storage.increment_key_index().await?;
        self.derive_swap_params_at_index(index).await
    }

    /// Sets the local key index to [`index`]
    pub async fn set_key_index(&self, index: u32) -> Result<()> {
        self.storage.set_key_index(index).await
    }

    /// Derive swap parameters at a specific index (for recovery).
    ///
    /// This does not modify the stored key index.
    pub async fn derive_swap_params_at_index(&self, index: u32) -> Result<SwapParams> {
        let mnemonic = self
            .storage
            .get_mnemonic()
            .await?
            .ok_or(Error::NoMnemonic)?;

        let wallet = HdWallet::from_mnemonic(&mnemonic, self.network.to_bitcoin_network())?;
        wallet.derive_swap_params(index)
    }

    /// Get the user ID Xpub for wallet recovery.
    ///
    /// This extended public key can be shared with the server to enable
    /// recovery of past swaps.
    pub async fn get_user_id_xpub(&self) -> Result<Option<String>> {
        let mnemonic = match self.storage.get_mnemonic().await? {
            Some(m) => m,
            None => return Ok(None),
        };

        let wallet = HdWallet::from_mnemonic(&mnemonic, self.network.to_bitcoin_network())?;
        let xpub = wallet.derive_user_id_xpub()?;
        Ok(Some(xpub.to_string()))
    }

    /// Get the current key derivation index.
    pub async fn get_key_index(&self) -> Result<u32> {
        self.storage.get_key_index().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::memory::MemoryWalletStorage;

    #[tokio::test]
    async fn test_generate_or_get_mnemonic() {
        let storage = MemoryWalletStorage::new();
        let wallet = Wallet::new(storage, Network::Bitcoin);

        // First call should generate
        let mnemonic1 = wallet.generate_or_get_mnemonic().await.unwrap();
        assert!(!mnemonic1.is_empty());

        // Second call should return same mnemonic
        let mnemonic2 = wallet.generate_or_get_mnemonic().await.unwrap();
        assert_eq!(mnemonic1, mnemonic2);
    }

    #[tokio::test]
    async fn test_import_mnemonic() {
        let storage = MemoryWalletStorage::new();
        let wallet = Wallet::new(storage, Network::Bitcoin);

        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        wallet.import_mnemonic(phrase).await.unwrap();

        let stored = wallet.get_mnemonic().await.unwrap().unwrap();
        assert_eq!(stored, phrase);
    }

    #[tokio::test]
    async fn test_derive_swap_params() {
        let storage = MemoryWalletStorage::new();
        let wallet = Wallet::new(storage, Network::Bitcoin);

        wallet.generate_or_get_mnemonic().await.unwrap();

        // First derivation should use index 0
        let params1 = wallet.derive_swap_params().await.unwrap();
        assert_eq!(params1.key_index, 0);

        // Second derivation should use index 1
        let params2 = wallet.derive_swap_params().await.unwrap();
        assert_eq!(params2.key_index, 1);

        // Keys should be different
        assert_ne!(params1.secret_key, params2.secret_key);
    }
}
