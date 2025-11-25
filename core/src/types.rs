//! Shared types for the Lendaswap Client SDK.

use bitcoin::secp256k1::{PublicKey, SecretKey};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Serde module for serializing `[u8; 32]` as hex strings.
mod hex_bytes32 {
    use super::*;

    pub fn serialize<S>(bytes: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&hex::encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 32], D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let bytes = hex::decode(&s).map_err(serde::de::Error::custom)?;
        bytes
            .try_into()
            .map_err(|_| serde::de::Error::custom("expected 32 bytes"))
    }
}

/// Bitcoin network type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    /// Bitcoin mainnet.
    Bitcoin,
    /// Bitcoin testnet.
    Testnet,
    /// Bitcoin regtest (local development).
    Regtest,
    /// Mutinynet (signet).
    Mutinynet,
}

impl Network {
    /// Convert to bitcoin crate's Network type.
    pub fn to_bitcoin_network(self) -> bitcoin::Network {
        match self {
            Network::Bitcoin => bitcoin::Network::Bitcoin,
            Network::Testnet => bitcoin::Network::Testnet,
            Network::Regtest => bitcoin::Network::Regtest,
            Network::Mutinynet => bitcoin::Network::Signet,
        }
    }
}

impl std::str::FromStr for Network {
    type Err = crate::error::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "bitcoin" | "mainnet" => Ok(Network::Bitcoin),
            "testnet" | "testnet3" => Ok(Network::Testnet),
            "regtest" => Ok(Network::Regtest),
            "mutinynet" | "signet" => Ok(Network::Mutinynet),
            _ => Err(crate::error::Error::Parse(format!(
                "Unknown network: {}",
                s
            ))),
        }
    }
}

impl std::fmt::Display for Network {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Network::Bitcoin => write!(f, "bitcoin"),
            Network::Testnet => write!(f, "testnet"),
            Network::Regtest => write!(f, "regtest"),
            Network::Mutinynet => write!(f, "mutinynet"),
        }
    }
}

/// Parameters derived for a swap operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapParams {
    pub secret_key: SecretKey,
    pub public_key: PublicKey,
    #[serde(with = "hex_bytes32")]
    pub preimage: [u8; 32],
    #[serde(with = "hex_bytes32")]
    pub preimage_hash: [u8; 32],
    pub user_id: PublicKey,
    pub key_index: u32,
}

/// VHTLC amounts returned from Arkade.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VhtlcAmounts {
    /// Amount that can be spent (in satoshis).
    pub spendable: u64,
    /// Amount already spent (in satoshis).
    pub spent: u64,
    /// Amount that can be recovered via refund (in satoshis).
    pub recoverable: u64,
}

/// Swap data stored locally for VHTLC operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapData {
    /// HD derivation index for this swap.
    pub key_index: u32,
    /// Public key of Lendaswap service (hex-encoded).
    pub lendaswap_pk: String,
    /// Arkade server public key (hex-encoded).
    pub arkade_server_pk: String,
    /// Absolute locktime for refunds (Unix timestamp).
    pub refund_locktime: u32,
    /// Relative delay for unilateral claim (parsed with parse_sequence_number).
    pub unilateral_claim_delay: i64,
    /// Relative delay for unilateral refund (parsed with parse_sequence_number).
    pub unilateral_refund_delay: i64,
    /// Relative delay for unilateral refund without receiver.
    pub unilateral_refund_without_receiver_delay: i64,
    /// Bitcoin network.
    pub network: Network,
    /// VHTLC address on Arkade.
    pub vhtlc_address: String,
}
