//! WASM-friendly type wrappers.
//!
//! These types wrap the core SDK types with wasm_bindgen annotations
//! for seamless JavaScript interop.

use wasm_bindgen::prelude::*;

/// Parameters derived for a swap operation.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct SwapParams {
    /// Secret key (hex-encoded).
    #[wasm_bindgen(getter_with_clone)]
    pub own_sk: String,
    /// Public key (hex-encoded).
    #[wasm_bindgen(getter_with_clone)]
    pub own_pk: String,
    /// Preimage for HTLC (hex-encoded).
    #[wasm_bindgen(getter_with_clone)]
    pub preimage: String,
    /// Hash of the preimage (hex-encoded).
    #[wasm_bindgen(getter_with_clone)]
    pub preimage_hash: String,
    /// User ID derived from HD wallet (hex-encoded).
    #[wasm_bindgen(getter_with_clone)]
    pub user_id: String,
    /// Key derivation index used.
    pub key_index: u32,
}

impl From<lendaswap_core::SwapParams> for SwapParams {
    fn from(params: lendaswap_core::SwapParams) -> Self {
        Self {
            own_sk: hex::encode(params.secret_key.secret_bytes()),
            own_pk: hex::encode(params.public_key.serialize()),
            preimage: hex::encode(params.preimage),
            preimage_hash: hex::encode(params.preimage_hash),
            user_id: hex::encode(params.user_id.serialize()),
            key_index: params.key_index,
        }
    }
}

impl TryFrom<&SwapParams> for lendaswap_core::SwapParams {
    type Error = String;

    fn try_from(params: &SwapParams) -> Result<Self, Self::Error> {
        use bitcoin::secp256k1::{PublicKey, SecretKey};

        let sk_bytes = hex::decode(&params.own_sk).map_err(|e| format!("Invalid secret key hex: {}", e))?;
        let secret_key = SecretKey::from_slice(&sk_bytes).map_err(|e| format!("Invalid secret key: {}", e))?;

        let pk_bytes = hex::decode(&params.own_pk).map_err(|e| format!("Invalid public key hex: {}", e))?;
        let public_key = PublicKey::from_slice(&pk_bytes).map_err(|e| format!("Invalid public key: {}", e))?;

        let preimage_bytes = hex::decode(&params.preimage).map_err(|e| format!("Invalid preimage hex: {}", e))?;
        let preimage: [u8; 32] = preimage_bytes.try_into().map_err(|_| "Preimage must be 32 bytes")?;

        let hash_bytes = hex::decode(&params.preimage_hash).map_err(|e| format!("Invalid preimage_hash hex: {}", e))?;
        let preimage_hash: [u8; 32] = hash_bytes.try_into().map_err(|_| "Preimage hash must be 32 bytes")?;

        let user_id_bytes = hex::decode(&params.user_id).map_err(|e| format!("Invalid user_id hex: {}", e))?;
        let user_id = PublicKey::from_slice(&user_id_bytes).map_err(|e| format!("Invalid user_id: {}", e))?;

        Ok(lendaswap_core::SwapParams {
            secret_key,
            public_key,
            preimage,
            preimage_hash,
            user_id,
            key_index: params.key_index,
        })
    }
}

/// VHTLC amounts returned from Arkade.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct VhtlcAmounts {
    /// Amount that can be spent (in satoshis).
    pub spendable: u64,
    /// Amount already spent (in satoshis).
    pub spent: u64,
    /// Amount that can be recovered via refund (in satoshis).
    pub recoverable: u64,
}

impl From<lendaswap_core::VhtlcAmounts> for VhtlcAmounts {
    fn from(amounts: lendaswap_core::VhtlcAmounts) -> Self {
        Self {
            spendable: amounts.spendable,
            spent: amounts.spent,
            recoverable: amounts.recoverable,
        }
    }
}
