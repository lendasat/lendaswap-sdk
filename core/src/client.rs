use crate::api::{
    AssetPair, BtcToEvmSwapResponse, EvmChain, EvmToArkadeSwapRequest, EvmToBtcSwapResponse,
    EvmToLightningSwapRequest, GetSwapResponse, QuoteRequest, QuoteResponse, SwapRequest, TokenId,
    TokenInfo, Version,
};
use crate::storage::{SwapStorage, WalletStorage};
use crate::types::SwapData;
use crate::{ApiClient, Network, SwapParams, VhtlcAmounts, Wallet, vhtlc};
use ark_rs::core::ArkAddress;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// Extended swap data that combines the API response with client-side swap parameters.
///
/// This is the data structure stored for each swap, containing both the server response
/// and the cryptographic parameters derived by the client.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtendedSwapStorageData {
    /// The swap response from the API.
    pub response: GetSwapResponse,
    /// Client-side swap parameters (keys, preimage, etc.).
    /// Sometimes not relevant, e.g. for evm-to-lightning swaps.
    pub swap_params: SwapParams,
}

/// The main client for interacting with Lendaswap.
///
/// The client is parameterized by two storage backends:
/// - `S`: Typed storage for wallet data (mnemonic, key index)
/// - `SS`: Typed storage for swap data
pub struct Client<S: WalletStorage, SS: SwapStorage> {
    api_client: ApiClient,
    wallet: Wallet<S>,
    swap_storage: SS,
    arkade_url: String,
}

impl<S: WalletStorage, SS: SwapStorage> Client<S, SS> {
    /// Create a new client with separate wallet and swap storage.
    ///
    /// # Arguments
    /// * `url` - The Lendaswap API URL
    /// * `wallet_storage` - Storage for wallet data (mnemonic, key index)
    /// * `swap_storage` - Storage for swap data
    /// * `network` - The Bitcoin network to use
    /// * `arkade_url` - The Arkade server URL
    pub fn new(
        url: impl Into<String>,
        wallet_storage: S,
        swap_storage: SS,
        network: Network,
        arkade_url: String,
    ) -> Self {
        let api_client = ApiClient::new(url);
        let wallet = Wallet::new(wallet_storage, network);

        Self {
            api_client,
            wallet,
            swap_storage,
            arkade_url,
        }
    }

    /// Get a reference to the swap storage.
    pub fn swap_storage(&self) -> &SS {
        &self.swap_storage
    }

    pub async fn init(&self, mnemonic: Option<String>) -> crate::Result<()> {
        if let Some(mnemonic) = mnemonic {
            self.wallet.import_mnemonic(mnemonic.as_str()).await?;
        } else {
            self.wallet.generate_or_get_mnemonic().await?;
        }
        Ok(())
    }

    pub fn api_client(&self) -> &ApiClient {
        &self.api_client
    }

    pub fn wallet(&self) -> &Wallet<S> {
        &self.wallet
    }

    pub async fn create_arkade_to_evm_swap(
        &self,
        target_address: String,
        target_amount: Decimal,
        target_token: TokenId,
        target_chain: EvmChain,
        referral_code: Option<String>,
    ) -> crate::Result<BtcToEvmSwapResponse> {
        let swap_params = self.wallet.derive_swap_params().await?;

        let request = SwapRequest {
            target_address,
            target_amount,
            target_token,
            hash_lock: format!("0x{}", hex::encode(swap_params.preimage_hash)),
            refund_pk: hex::encode(swap_params.public_key.serialize()),
            user_id: hex::encode(swap_params.user_id.serialize()),
            referral_code,
        };

        let response = self
            .api_client
            .create_arkade_to_evm_swap(&request, target_chain)
            .await?;

        let swap_id = response.common.id.to_string();
        let swap_data = ExtendedSwapStorageData {
            response: GetSwapResponse::BtcToEvm(response.clone()),
            swap_params,
        };

        self.swap_storage.store(&swap_id, &swap_data).await?;

        Ok(response)
    }

    pub async fn create_evm_to_arkade_swap(
        &self,
        target_address: String,
        user_address: String,
        source_amount: Decimal,
        source_token: TokenId,
        source_chain: EvmChain,
        referral_code: Option<String>,
    ) -> crate::Result<EvmToBtcSwapResponse> {
        let swap_params = self.wallet.derive_swap_params().await?;

        let request = EvmToArkadeSwapRequest {
            target_address,
            source_amount,
            source_token,
            hash_lock: format!("0x{}", hex::encode(swap_params.preimage_hash)),
            receiver_pk: hex::encode(swap_params.public_key.serialize()),
            user_address,
            user_id: hex::encode(swap_params.user_id.serialize()),
            referral_code,
        };

        let response = self
            .api_client
            .create_evm_to_arkade_swap(&request, source_chain)
            .await?;
        let swap_id = response.common.id.to_string();
        let swap_data = ExtendedSwapStorageData {
            response: GetSwapResponse::EvmToBtc(response.clone()),
            swap_params,
        };

        self.swap_storage.store(&swap_id, &swap_data).await?;

        Ok(response)
    }

    pub async fn create_evm_to_lightning_swap(
        &self,
        bolt11_invoice: String,
        user_address: String,
        source_token: TokenId,
        source_chain: EvmChain,
        referral_code: Option<String>,
    ) -> crate::Result<EvmToBtcSwapResponse> {
        let swap_params = self.wallet.derive_swap_params().await?;

        let request = EvmToLightningSwapRequest {
            bolt11_invoice,
            source_token,
            user_address,
            user_id: hex::encode(swap_params.user_id.serialize()),
            referral_code,
        };

        let response = self
            .api_client
            .create_evm_to_lightning_swap(&request, source_chain)
            .await?;
        let swap_id = response.common.id.to_string();
        let swap_data = ExtendedSwapStorageData {
            response: GetSwapResponse::EvmToBtc(response.clone()),
            swap_params,
        };

        self.swap_storage.store(&swap_id, &swap_data).await?;

        Ok(response)
    }

    pub async fn get_asset_pairs(&self) -> crate::Result<Vec<AssetPair>> {
        let asset_pairs = self.api_client.get_asset_pairs().await?;
        Ok(asset_pairs)
    }

    pub async fn get_tokens(&self) -> crate::Result<Vec<TokenInfo>> {
        let tokens = self.api_client.get_tokens().await?;
        Ok(tokens)
    }

    /// Get swap details by ID.
    ///
    /// This fetches the latest swap status from the API and updates the local storage.
    pub async fn get_swap(&self, id: &str) -> crate::Result<ExtendedSwapStorageData> {
        let maybe_data = self.swap_storage.get(id).await?;

        match maybe_data {
            None => Err(crate::Error::SwapNotFound(format!(
                "Swap id not found {id}"
            ))),
            Some(known) => {
                let swap_response = self.api_client.get_swap(id).await?;
                let new_extended_swap_data = ExtendedSwapStorageData {
                    response: swap_response,
                    swap_params: known.swap_params,
                };

                self.swap_storage.store(id, &new_extended_swap_data).await?;
                Ok(new_extended_swap_data)
            }
        }
    }

    pub async fn get_quote(&self, request: &QuoteRequest) -> crate::Result<QuoteResponse> {
        let response = self.api_client.get_quote(request).await?;
        Ok(response)
    }

    pub async fn claim_gelato(
        &self,
        swap_id: &str,
        maybe_secret: Option<String>,
    ) -> crate::Result<()> {
        if let Some(secret) = maybe_secret {
            self.api_client.claim_gelato(swap_id, &secret).await?;
            return Ok(());
        }

        let swap_data = self.load_swap_data_from_storage(swap_id).await?;
        let preimage = swap_data.swap_params.preimage;
        let preimage = hex::encode(preimage);
        self.api_client.claim_gelato(swap_id, &preimage).await
    }

    pub async fn claim_vhtlc(&self, swap_id: &str) -> crate::Result<String> {
        let swap_data = self.load_swap_data_from_storage(swap_id).await?;
        if let GetSwapResponse::EvmToBtc(data) = &swap_data.response {
            match &data.user_address_arkade {
                None => Err(crate::Error::Vhtlc(
                    "Cannot refund if no arkade address was provided".to_string(),
                )),
                Some(arkade_address) => {
                    let address = ArkAddress::from_str(arkade_address)
                        .map_err(|e| crate::Error::Parse(format!("Invalid ark address {e})")))?;

                    let common_swap_data = swap_data.response.common();
                    let txid = vhtlc::claim(
                        &self.arkade_url,
                        address,
                        SwapData {
                            key_index: swap_data.swap_params.key_index,
                            lendaswap_pk: data.common.receiver_pk.clone(),
                            arkade_server_pk: data.common.server_pk.clone(),
                            refund_locktime: common_swap_data.refund_locktime,
                            unilateral_claim_delay: common_swap_data.unilateral_claim_delay,
                            unilateral_refund_delay: common_swap_data.unilateral_refund_delay,
                            unilateral_refund_without_receiver_delay: common_swap_data
                                .unilateral_refund_without_receiver_delay,
                            network: common_swap_data.network.parse()?,
                            vhtlc_address: data.htlc_address_arkade.clone(),
                        },
                        swap_data.swap_params,
                        self.wallet.network(),
                    )
                    .await?;

                    Ok(txid.to_string())
                }
            }
        } else {
            Err(crate::Error::Vhtlc(
                "Swap was not a Evm to Btc swap".to_string(),
            ))
        }
    }

    /// Get the [`VhtlcAmounts`] for a BTC-EVM swap.
    ///
    /// This only applies to swaps where the client funds the Arkade VHTLC.
    pub async fn amounts_for_swap(&self, swap_id: &str) -> crate::Result<VhtlcAmounts> {
        let swap_data = self.load_swap_data_from_storage(swap_id).await?;
        if let GetSwapResponse::BtcToEvm(data) = &swap_data.response {
            let common_swap_data = swap_data.response.common();
            let amounts = vhtlc::amounts(
                &self.arkade_url,
                SwapData {
                    key_index: swap_data.swap_params.key_index,
                    lendaswap_pk: data.common.receiver_pk.clone(),
                    arkade_server_pk: data.common.server_pk.clone(),
                    refund_locktime: common_swap_data.refund_locktime,
                    unilateral_claim_delay: common_swap_data.unilateral_claim_delay,
                    unilateral_refund_delay: common_swap_data.unilateral_refund_delay,
                    unilateral_refund_without_receiver_delay: common_swap_data
                        .unilateral_refund_without_receiver_delay,
                    network: common_swap_data.network.parse()?,
                    vhtlc_address: data.htlc_address_arkade.clone(),
                },
            )
            .await?;

            Ok(amounts)
        } else {
            Err(crate::Error::Vhtlc(
                "Swap was not a Btc to Evm swap".to_string(),
            ))
        }
    }

    /// Refund the VHTLC of a BTC-EVM swap.
    ///
    /// This only applies to swaps where the client funds the Arkade VHTLC directly with Arkade. It
    /// does not apply to swaps funded with Lightning, since the user's Lightning wallet is
    /// responsible for refunding the Lightning HTLC.
    pub async fn refund_vhtlc(&self, swap_id: &str, refund_address: &str) -> crate::Result<String> {
        let swap_data = self.load_swap_data_from_storage(swap_id).await?;
        if let GetSwapResponse::BtcToEvm(data) = &swap_data.response {
            let refund_address = ArkAddress::from_str(refund_address)
                .map_err(|e| crate::Error::Parse(format!("Invalid refund ark address {e})")))?;

            let common_swap_data = swap_data.response.common();
            let txid = vhtlc::refund(
                &self.arkade_url,
                refund_address,
                SwapData {
                    key_index: swap_data.swap_params.key_index,
                    lendaswap_pk: data.common.receiver_pk.clone(),
                    arkade_server_pk: data.common.server_pk.clone(),
                    refund_locktime: common_swap_data.refund_locktime,
                    unilateral_claim_delay: common_swap_data.unilateral_claim_delay,
                    unilateral_refund_delay: common_swap_data.unilateral_refund_delay,
                    unilateral_refund_without_receiver_delay: common_swap_data
                        .unilateral_refund_without_receiver_delay,
                    network: common_swap_data.network.parse()?,
                    vhtlc_address: data.htlc_address_arkade.clone(),
                },
                swap_data.swap_params,
                self.wallet.network(),
            )
            .await?;

            Ok(txid.to_string())
        } else {
            Err(crate::Error::Vhtlc(
                "Swap was not a Btc to Evm swap".to_string(),
            ))
        }
    }

    /// Load swap data from storage without fetching from the API.
    pub async fn load_swap_data_from_storage(
        &self,
        swap_id: &str,
    ) -> crate::Result<ExtendedSwapStorageData> {
        self.swap_storage
            .get(swap_id)
            .await?
            .ok_or_else(|| crate::Error::SwapNotFound(format!("Swap id not found {swap_id}")))
    }

    /// Load swap data from storage without fetching from the API.
    pub async fn list_all(&self) -> crate::Result<Vec<ExtendedSwapStorageData>> {
        let swaps = self.swap_storage.get_all().await?;

        Ok(swaps)
    }

    pub async fn get_version(&self) -> crate::Result<Version> {
        let version = self.api_client.get_version().await?;
        Ok(version)
    }

    pub async fn recover_swaps(&self) -> crate::Result<Vec<ExtendedSwapStorageData>> {
        self.clear_swap_storage().await?;

        let xpub = self
            .wallet
            .get_user_id_xpub()
            .await
            .map_err(|e| crate::Error::Other(format!("Could not retrieve user xpub {e:#}")))?
            .ok_or(crate::Error::NoMnemonic)?;
        let recovered = self.api_client.recover_swaps(xpub.as_str()).await?;

        for recovered_swap in recovered.swaps {
            let swap_params = self
                .wallet
                .derive_swap_params_at_index(recovered_swap.index)
                .await?;
            let swap_id = recovered_swap.swap.id();
            let data = ExtendedSwapStorageData {
                response: recovered_swap.swap,
                swap_params,
            };

            self.swap_storage.store(swap_id.as_str(), &data).await?;
        }

        self.wallet.set_key_index(recovered.highest_index).await?;

        let all_swaps = self.swap_storage.get_all().await?;
        Ok(all_swaps)
    }

    pub async fn get_mnemonic(&self) -> crate::Result<String> {
        let mnemonic = self
            .wallet
            .get_mnemonic()
            .await
            .map_err(|e| crate::Error::Other(format!("Could not read mnemonic {e:#}")))?
            .ok_or(crate::Error::NoMnemonic)?;
        Ok(mnemonic)
    }

    pub async fn get_user_id_xpub(&self) -> crate::Result<String> {
        let xpub = self
            .wallet
            .get_user_id_xpub()
            .await?
            .ok_or(crate::Error::NoMnemonic)?;
        Ok(xpub)
    }

    pub async fn clear_swap_storage(&self) -> crate::Result<()> {
        let swap_ids = self.swap_storage.list().await?;
        for id in swap_ids {
            self.swap_storage.delete(&id).await?;
        }
        Ok(())
    }
    pub async fn delete_swap(&self, id: String) -> crate::Result<()> {
        self.swap_storage.delete(&id).await?;
        Ok(())
    }
}
