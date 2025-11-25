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
