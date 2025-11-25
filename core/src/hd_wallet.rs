//! Hierarchical Deterministic (HD) wallet implementation.
//!
//! This module provides BIP39/BIP32 key derivation for Lendaswap swaps.

use crate::error::{Error, Result};
use crate::types::SwapParams;
use anyhow::Context;
use bitcoin::bip32::{DerivationPath, Xpriv, Xpub};
use bitcoin::key::Secp256k1;
use bitcoin::secp256k1::PublicKey;
use sha2::{Digest, Sha256};
use std::str::FromStr;

/// BIP-85 prefix for signing keys.
const SIGNING_PREFIX: u32 = 83696968;
/// Prefix for identity key derivation.
const ID_PREFIX: u32 = 9419;
/// Lendaswap identifier ("LSW" encoded).
const LSW_IDENTIFIER: u32 = 121923;
/// Tag for BIP340-style tagged hash preimage generation.
const PREIMAGE_TAG: &str = "lendaswap/preimage";

/// HD Wallet for Lendaswap key derivation.
pub struct HdWallet {
    mnemonic: bip39::Mnemonic,
    network: bitcoin::Network,
}

impl HdWallet {
    /// Generate a new HD wallet with a random mnemonic.
    ///
    /// # Arguments
    /// * `network` - Bitcoin network to use
    /// * `word_count` - Number of words (12, 15, 18, 21, or 24)
    pub fn generate(network: bitcoin::Network, word_count: usize) -> Result<Self> {
        use bip39::{Language, Mnemonic};
        use rand::rngs::OsRng;

        let mnemonic = Mnemonic::generate_in_with(&mut OsRng, Language::English, word_count)
            .map_err(|e| Error::KeyDerivation(format!("Failed to generate mnemonic: {}", e)))?;

        Ok(Self { mnemonic, network })
    }

    /// Create an HD wallet from an existing mnemonic phrase.
    pub fn from_mnemonic(phrase: &str, network: bitcoin::Network) -> Result<Self> {
        use bip39::Mnemonic;
        use std::str::FromStr;

        let mnemonic =
            Mnemonic::from_str(phrase).map_err(|e| Error::InvalidMnemonic(format!("{}", e)))?;

        Ok(Self { mnemonic, network })
    }

    /// Get the mnemonic phrase as a string.
    pub fn mnemonic_phrase(&self) -> String {
        self.mnemonic.to_string()
    }

    /// Derive swap parameters at the given index.
    ///
    /// Derivation path: `m/{SIGNING_PREFIX}'/{LSW_IDENTIFIER}'/{index}'`
    pub fn derive_swap_params(&self, index: u32) -> Result<SwapParams> {
        use bitcoin::bip32::{DerivationPath, Xpriv};
        use bitcoin::secp256k1::Secp256k1;
        use sha2::{Digest, Sha256};

        let secp = Secp256k1::new();
        let seed = self.mnemonic.to_seed("");
        let master = Xpriv::new_master(self.network, &seed)
            .map_err(|e| Error::KeyDerivation(format!("Failed to derive master key: {}", e)))?;

        // Derive signing key: m/{SIGNING_PREFIX}'/{LSW_IDENTIFIER}'/{index}'
        let path_str = format!("m/{}'/{}'/{}'", SIGNING_PREFIX, LSW_IDENTIFIER, index);
        let path: DerivationPath = path_str
            .parse()
            .map_err(|e| Error::KeyDerivation(format!("Invalid derivation path: {}", e)))?;

        let derived = master
            .derive_priv(&secp, &path)
            .map_err(|e| Error::KeyDerivation(format!("Key derivation failed: {}", e)))?;

        let secret_key = derived.private_key;
        let public_key = secret_key.public_key(&secp);

        // Generate preimage using tagged hash (BIP340-style)
        // preimage = sha256(sha256(tag) || sha256(tag) || secret_key)
        let preimage = tagged_hash(PREIMAGE_TAG, &secret_key.secret_bytes());

        // preimage_hash = sha256(preimage)
        let preimage_hash = Sha256::digest(preimage).into();

        // Derive user ID
        let user_id = self
            .derive_user_id(index)
            .context("failed to derive user_id")?;

        Ok(SwapParams {
            secret_key,
            public_key,
            preimage,
            preimage_hash,
            user_id,
            key_index: index,
        })
    }

    /// Derive a `user_id` at the specified index. The `user_id` is actually just a public key.
    ///
    /// User IDs are derived using a non-hardened path, so that the corresponding Xpub can be shared
    /// with the server for efficient recovery of swap data.
    fn derive_user_id(&self, index: u32) -> Result<PublicKey> {
        let secp = Secp256k1::new();
        let xpub = self
            .derive_user_id_xpub()
            .context("could not derive user ID Xpub")?;

        // Build non-hardened derivation path.
        let path_str = format!("m/{ID_PREFIX}/{LSW_IDENTIFIER}/{index}");
        let path = DerivationPath::from_str(&path_str).context("Invalid derivation path")?;

        let derived_xpub = xpub
            .derive_pub(&secp, &path)
            .context("Failed to derive user_id")?;

        Ok(derived_xpub.public_key)
    }

    /// Derive the master extended private key from the mnemonic
    fn master_xpriv(&self) -> anyhow::Result<Xpriv> {
        // No passphrase.
        let seed = self.mnemonic.to_seed("");
        let xpriv = Xpriv::new_master(self.network, &seed).context("Failed to derive Xpriv")?;

        Ok(xpriv)
    }

    /// Derive an Xpub used to derive user IDs.
    ///
    /// This Xpub is derived using a hardened path, to ensure that if individual secret keys derived
    /// from it are leaked, the parent Xpriv is safe.
    ///
    /// This Xpub is used for wallet recovery: the server derives individual `user_id`s from it.
    pub fn derive_user_id_xpub(&self) -> anyhow::Result<Xpub> {
        let secp = Secp256k1::new();
        let master = self.master_xpriv()?;

        // Build hardened derivation path.
        let path_str = format!("m/{ID_PREFIX}'/{LSW_IDENTIFIER}'/0'");
        let path = DerivationPath::from_str(&path_str).context("Invalid derivation path")?;

        let derived_xpriv = master
            .derive_priv(&secp, &path)
            .context("Failed to derive user_id Xpriv")?;

        Ok(Xpub::from_priv(&secp, &derived_xpriv))
    }
}

/// BIP340-style tagged hash function for domain separation.
///
/// Computes: sha256(sha256(tag) || sha256(tag) || data).
fn tagged_hash(tag: &str, data: &[u8]) -> [u8; 32] {
    let tag_hash = Sha256::digest(tag.as_bytes());
    let mut hasher = Sha256::new();
    hasher.update(tag_hash);
    hasher.update(tag_hash);
    hasher.update(data);
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::Network;

    #[test]
    fn test_generate_wallet() {
        let wallet = HdWallet::generate(Network::Bitcoin, 12).unwrap();
        let mnemonic = wallet.mnemonic_phrase();
        assert!(mnemonic.split_whitespace().count() == 12);
    }

    #[test]
    fn test_derive_keypair() {
        let wallet = HdWallet::generate(Network::Bitcoin, 12).unwrap();
        let SwapParams {
            secret_key: sk1,
            public_key: pk1,
            preimage: preimage1,
            preimage_hash: preimage_hash1,
            ..
        } = wallet.derive_swap_params(0).unwrap();
        let SwapParams {
            secret_key: sk2,
            public_key: pk2,
            preimage: preimage2,
            preimage_hash: preimage_hash2,
            ..
        } = wallet.derive_swap_params(1).unwrap();

        // Different indices should produce different keys
        assert_ne!(sk1.secret_bytes(), sk2.secret_bytes());
        assert_ne!(pk1, pk2);

        assert_ne!(preimage1, preimage2);
        assert_ne!(preimage_hash1, preimage_hash2);

        // Same index should produce same keys
        let SwapParams {
            secret_key: sk1_again,
            public_key: pk1_again,
            preimage: preimage1_again,
            preimage_hash: preimage_hash1_again,
            ..
        } = wallet.derive_swap_params(0).unwrap();

        assert_eq!(sk1.secret_bytes(), sk1_again.secret_bytes());
        assert_eq!(pk1, pk1_again);

        assert_eq!(preimage1, preimage1_again);
        assert_eq!(preimage_hash1, preimage_hash1_again);
    }

    #[test]
    fn test_from_mnemonic() {
        let wallet1 = HdWallet::generate(Network::Bitcoin, 12).unwrap();
        let phrase = wallet1.mnemonic_phrase();

        let wallet2 = HdWallet::from_mnemonic(&phrase, Network::Bitcoin).unwrap();

        // Same mnemonic should produce same keys and preimages
        let SwapParams {
            secret_key: sk1,
            preimage: preimage1,
            ..
        } = wallet1.derive_swap_params(0).unwrap();
        let SwapParams {
            secret_key: sk2,
            preimage: preimage2,
            ..
        } = wallet2.derive_swap_params(0).unwrap();

        assert_eq!(sk1.secret_bytes(), sk2.secret_bytes());
        assert_eq!(preimage1, preimage2);
    }
}
