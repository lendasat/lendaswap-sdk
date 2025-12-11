use crate::JsSwapStorageAdapter;
use crate::JsSwapStorageProvider;
use crate::JsWalletStorageAdapter;
use crate::JsWalletStorageProvider;
use crate::TokenId;
use crate::Version;
use crate::to_js_value;
use lendaswap_core;
use lendaswap_core::api as core_api;
use rust_decimal::Decimal;
use rust_decimal::prelude::FromPrimitive;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

/// Chain type for token information.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub enum Chain {
    Arkade,
    Lightning,
    Polygon,
    Ethereum,
}

impl From<core_api::Chain> for Chain {
    fn from(c: core_api::Chain) -> Self {
        match c {
            core_api::Chain::Arkade => Chain::Arkade,
            core_api::Chain::Lightning => Chain::Lightning,
            core_api::Chain::Polygon => Chain::Polygon,
            core_api::Chain::Ethereum => Chain::Ethereum,
        }
    }
}

/// Token information.
#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct TokenInfo {
    #[wasm_bindgen(js_name = "tokenId")]
    pub token_id: String,
    pub symbol: String,
    pub chain: Chain,
    pub name: String,
    pub decimals: u8,
}

impl From<core_api::TokenInfo> for TokenInfo {
    fn from(t: core_api::TokenInfo) -> Self {
        TokenInfo {
            token_id: t.token_id.to_string(),
            symbol: t.symbol,
            chain: t.chain.into(),
            name: t.name,
            decimals: t.decimals,
        }
    }
}
/// Token information.
#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct AssetPair {
    pub source: TokenInfo,
    pub target: TokenInfo,
}

impl From<core_api::AssetPair> for AssetPair {
    fn from(t: core_api::AssetPair) -> Self {
        AssetPair {
            source: t.source.into(),
            target: t.target.into(),
        }
    }
}

/// Quote response from the API.
#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct QuoteResponse {
    #[wasm_bindgen(js_name = "exchangeRate")]
    pub exchange_rate: String,
    #[wasm_bindgen(js_name = "networkFee")]
    pub network_fee: u64,
    #[wasm_bindgen(js_name = "protocolFee")]
    pub protocol_fee: u64,
    #[wasm_bindgen(js_name = "protocolFeeRate")]
    pub protocol_fee_rate: f64,
    #[wasm_bindgen(js_name = "minAmount")]
    pub min_amount: u64,
    #[wasm_bindgen(js_name = "maxAmount")]
    pub max_amount: u64,
}

impl From<core_api::QuoteResponse> for QuoteResponse {
    fn from(r: core_api::QuoteResponse) -> Self {
        QuoteResponse {
            exchange_rate: r.exchange_rate,
            network_fee: r.network_fee,
            protocol_fee: r.protocol_fee,
            protocol_fee_rate: r.protocol_fee_rate,
            min_amount: r.min_amount,
            max_amount: r.max_amount,
        }
    }
}

/// Lendaswap client.
#[wasm_bindgen]
pub struct Client {
    inner: lendaswap_core::Client<JsWalletStorageAdapter, JsSwapStorageAdapter>,
}

#[wasm_bindgen]
impl Client {
    /// Create a new client with separate wallet and swap storage.
    ///
    /// # Arguments
    /// * `base_url` - The Lendaswap API URL
    /// * `wallet_storage` - Storage provider for wallet data (mnemonic, key index)
    /// * `swap_storage` - Storage provider for swap data
    /// * `network` - The Bitcoin network ("bitcoin" or "testnet")
    /// * `arkade_url` - The Arkade server URL
    #[wasm_bindgen(constructor)]
    pub fn new(
        base_url: String,
        wallet_storage: JsWalletStorageProvider,
        swap_storage: JsSwapStorageProvider,
        network: String,
        arkade_url: String,
    ) -> Result<Client, JsValue> {
        let network = network
            .parse()
            .map_err(|e: lendaswap_core::Error| JsValue::from_str(&format!("{}", e)))?;
        let wallet_adapter = JsWalletStorageAdapter::new(wallet_storage);
        let swap_adapter = JsSwapStorageAdapter::new(swap_storage);

        Ok(Client {
            inner: lendaswap_core::Client::new(
                base_url,
                wallet_adapter,
                swap_adapter,
                network,
                arkade_url,
            ),
        })
    }

    #[wasm_bindgen(js_name = "init")]
    pub async fn init(&self, mnemonic: Option<String>) -> Result<(), JsValue> {
        self.inner
            .init(mnemonic)
            .await
            .map_err(|e: lendaswap_core::Error| JsValue::from_str(&format!("{}", e)))?;
        Ok(())
    }

    /// Create an Arkade to EVM swap.
    #[wasm_bindgen(js_name = "createArkadeToEvmSwap")]
    pub async fn create_arkade_to_evm_swap(
        &self,
        target_address: String,
        target_amount: f64,
        target_token: String,
        target_chain: String,
        referral_code: Option<String>,
    ) -> Result<JsValue, JsValue> {
        let target_token = match target_token.as_str() {
            "btc_lightning" => core_api::TokenId::BtcLightning,
            "btc_arkade" => core_api::TokenId::BtcArkade,
            // All other tokens use the Coin variant
            other => core_api::TokenId::Coin(other.to_string()),
        };

        let target_amount = Decimal::from_f64(target_amount)
            .ok_or_else(|| JsValue::from_str("Could not parse target amount"))?;

        let target_chain: core_api::EvmChain = target_chain
            .parse()
            .map_err(|e: String| JsValue::from_str(&e))?;

        let swap = self
            .inner
            .create_arkade_to_evm_swap(
                target_address,
                target_amount,
                target_token,
                target_chain,
                referral_code,
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        to_js_value(&swap)
    }

    /// Create an EVM to Arkade swap.
    #[wasm_bindgen(js_name = "createEvmToArkadeSwap")]
    pub async fn create_evm_to_arkade_swap(
        &self,
        target_address: String,
        user_address: String,
        source_amount: f64,
        source_token: String,
        source_chain: String,
        referral_code: Option<String>,
    ) -> Result<JsValue, JsValue> {
        let source_token = match source_token.as_str() {
            "btc_lightning" => core_api::TokenId::BtcLightning,
            "btc_arkade" => core_api::TokenId::BtcArkade,
            // All other tokens use the Coin variant
            other => core_api::TokenId::Coin(other.to_string()),
        };

        let source_amount = Decimal::from_f64(source_amount)
            .ok_or_else(|| JsValue::from_str("Could not parse target amount"))?;

        let source_chain: core_api::EvmChain = source_chain
            .parse()
            .map_err(|e: String| JsValue::from_str(&e))?;

        let swap = self
            .inner
            .create_evm_to_arkade_swap(
                target_address,
                user_address,
                source_amount,
                source_token,
                source_chain,
                referral_code,
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        to_js_value(&swap)
    }

    /// Create an EVM to Lightning swap.
    #[wasm_bindgen(js_name = "createEvmToLightningSwap")]
    pub async fn create_evm_to_lightning_swap(
        &self,
        bolt11_invoice: String,
        user_address: String,
        source_token: String,
        source_chain: String,
        referral_code: Option<String>,
    ) -> Result<JsValue, JsValue> {
        let source_token = match source_token.as_str() {
            "btc_lightning" => core_api::TokenId::BtcLightning,
            "btc_arkade" => core_api::TokenId::BtcArkade,
            // All other tokens use the Coin variant
            other => core_api::TokenId::Coin(other.to_string()),
        };

        let source_chain: core_api::EvmChain = source_chain
            .parse()
            .map_err(|e: String| JsValue::from_str(&e))?;

        let swap = self
            .inner
            .create_evm_to_lightning_swap(
                bolt11_invoice,
                user_address,
                source_token,
                source_chain,
                referral_code,
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        to_js_value(&swap)
    }

    #[wasm_bindgen(js_name = "getAssetPairs")]
    pub async fn get_asset_pairs(&self) -> Result<Vec<AssetPair>, JsValue> {
        let pairs = self
            .inner
            .get_asset_pairs()
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        let pairs: Vec<AssetPair> = pairs.into_iter().map(|t| t.into()).collect();

        Ok(pairs)
    }

    #[wasm_bindgen(js_name = "getTokens")]
    pub async fn get_tokens(&self) -> Result<Vec<TokenInfo>, JsValue> {
        let tokens = self
            .inner
            .get_tokens()
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        let tokens: Vec<TokenInfo> = tokens.into_iter().map(|t| t.into()).collect();
        Ok(tokens)
    }

    /// Get a quote.
    #[wasm_bindgen(js_name = "getQuote")]
    pub async fn get_quote(
        &self,
        from: String,
        to: String,
        base_amount: u64,
    ) -> Result<QuoteResponse, JsValue> {
        let from_token = TokenId::from_string(&from)?.0;
        let to_token = TokenId::from_string(&to)?.0;

        let request = core_api::QuoteRequest {
            from: from_token,
            to: to_token,
            base_amount,
        };

        self.inner
            .get_quote(&request)
            .await
            .map(Into::into)
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))
    }

    /// Get swap by ID.
    ///
    /// This function returns `[ExtendedSwapResponse]`. It's too complex for Wasm to handle.
    #[wasm_bindgen(js_name = "getSwap")]
    pub async fn get_swap(&self, id: String) -> Result<JsValue, JsValue> {
        let swap = self
            .inner
            .get_swap(&id)
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        to_js_value(&swap)
    }

    /// Get all swaps.
    ///
    /// This function returns `[ExtendedSwapResponse[]]`. It's too complex for Wasm to handle.
    #[wasm_bindgen(js_name = "listAll")]
    pub async fn list_all(&self) -> Result<JsValue, JsValue> {
        let swap = self
            .inner
            .list_all()
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        to_js_value(&swap)
    }

    #[wasm_bindgen(js_name = "claimGelato")]
    pub async fn claim_gelato(
        &self,
        swap_id: String,
        secret: Option<String>,
    ) -> Result<(), JsValue> {
        self.inner
            .claim_gelato(swap_id.as_str(), secret)
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        Ok(())
    }

    #[wasm_bindgen(js_name = "amountsForSwap")]
    pub async fn amounts_for_swap(&self, swap_id: String) -> Result<JsValue, JsValue> {
        let amounts = self
            .inner
            .amounts_for_swap(swap_id.as_str())
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        to_js_value(&amounts)
    }

    #[wasm_bindgen(js_name = "claimVhtlc")]
    pub async fn claim_vhtlc(&self, swap_id: String) -> Result<(), JsValue> {
        self.inner
            .claim_vhtlc(swap_id.as_str())
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        Ok(())
    }

    #[wasm_bindgen(js_name = "refundVhtlc")]
    pub async fn refund_vhtlc(
        &self,
        swap_id: String,
        refund_address: String,
    ) -> Result<String, JsValue> {
        let txid = self
            .inner
            .refund_vhtlc(swap_id.as_str(), refund_address.as_str())
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        Ok(txid)
    }

    /// Get API version.
    #[wasm_bindgen(js_name = "getVersion")]
    pub async fn get_version(&self) -> Result<Version, JsValue> {
        self.inner
            .get_version()
            .await
            .map(Into::into)
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))
    }

    /// Recover swaps using xpub.
    #[wasm_bindgen(js_name = "recoverSwaps")]
    pub async fn recover_swaps(&self) -> Result<JsValue, JsValue> {
        let response = self
            .inner
            .recover_swaps()
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        to_js_value(&response)
    }

    /// Get mnemonic
    #[wasm_bindgen(js_name = "getMnemonic")]
    pub async fn get_mnemonic(&self) -> Result<String, JsValue> {
        let response = self
            .inner
            .get_mnemonic()
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        Ok(response)
    }

    /// Get userIdXpub
    #[wasm_bindgen(js_name = "getUserIdXpub")]
    pub async fn get_user_id_xpub(&self) -> Result<String, JsValue> {
        let response = self
            .inner
            .get_user_id_xpub()
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        Ok(response)
    }

    /// Deletes all stored swaps
    #[wasm_bindgen(js_name = "clearSwapStorage")]
    pub async fn clear_swap_storage(&self) -> Result<(), JsValue> {
        self.inner
            .clear_swap_storage()
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        Ok(())
    }

    /// Delete specific swap
    #[wasm_bindgen(js_name = "deleteSwap")]
    pub async fn delete_swap(&self, id: String) -> Result<(), JsValue> {
        self.inner
            .delete_swap(id)
            .await
            .map_err(|e| JsValue::from_str(&format!("{:#}", e)))?;

        Ok(())
    }
}
