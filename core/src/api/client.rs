//! HTTP client for the Lendaswap backend API.

use crate::error::{Error, Result};

use super::types::*;

/// Lendaswap API client.
#[derive(Debug, Clone)]
pub struct ApiClient {
    base_url: String,
    client: reqwest::Client,
}

impl ApiClient {
    /// Create a new API client.
    ///
    /// # Arguments
    /// * `base_url` - Base URL of the Lendaswap API (e.g., "https://api.lendaswap.com")
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            client: reqwest::Client::new(),
        }
    }

    /// Get the base URL.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Health check endpoint.
    pub async fn health_check(&self) -> Result<String> {
        let url = format!("{}/health", self.base_url);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| Error::Network(format!("Failed to connect to {}: {}", url, e)))?;

        if !response.status().is_success() {
            return Err(Error::Network(format!(
                "Health check failed: {}",
                response.status()
            )));
        }

        response
            .text()
            .await
            .map_err(|e| Error::Network(format!("Failed to read response: {}", e)))
    }

    /// Get supported tokens.
    pub async fn get_tokens(&self) -> Result<Vec<TokenInfo>> {
        let url = format!("{}/tokens", self.base_url);
        self.get_json(&url).await
    }

    /// Get available asset pairs.
    pub async fn get_asset_pairs(&self) -> Result<Vec<AssetPair>> {
        let url = format!("{}/asset-pairs", self.base_url);
        self.get_json(&url).await
    }

    /// Get a quote for a swap.
    pub async fn get_quote(&self, request: &QuoteRequest) -> Result<QuoteResponse> {
        let url = format!(
            "{}/quote?from={}&to={}&base_amount={}",
            self.base_url, request.from, request.to, request.base_amount
        );
        self.get_json(&url).await
    }

    /// Get swap details by ID.
    pub async fn get_swap(&self, id: &str) -> Result<GetSwapResponse> {
        let url = format!("{}/swap/{}", self.base_url, id);
        self.get_json(&url).await
    }

    /// Create an Arkade to EVM swap (BTC → Token).
    ///
    /// # Arguments
    /// * `request` - Swap request parameters
    /// * `target_network` - Target EVM network (e.g., "polygon", "ethereum")
    pub async fn create_arkade_to_evm_swap(
        &self,
        request: &SwapRequest,
        target_network: EvmChain,
    ) -> Result<BtcToEvmSwapResponse> {
        let url = format!("{}/swap/arkade/{}", self.base_url, target_network);
        dbg!(&url);
        self.post_json(&url, request).await
    }

    /// Create an EVM to Arkade swap (Token → BTC).
    ///
    /// # Arguments
    /// * `request` - Swap request parameters
    /// * `source_network` - Source EVM network (e.g., "polygon", "ethereum")
    pub async fn create_evm_to_arkade_swap(
        &self,
        request: &EvmToArkadeSwapRequest,
        source_network: EvmChain,
    ) -> Result<EvmToBtcSwapResponse> {
        let url = format!("{}/swap/{}/arkade", self.base_url, source_network);
        self.post_json(&url, request).await
    }

    /// Create an EVM to Lightning swap (Token → Lightning).
    ///
    /// # Arguments
    /// * `request` - Swap request parameters
    /// * `source_network` - Source EVM network (e.g., "polygon", "ethereum")
    pub async fn create_evm_to_lightning_swap(
        &self,
        request: &EvmToLightningSwapRequest,
        source_network: EvmChain,
    ) -> Result<EvmToBtcSwapResponse> {
        let url = format!("{}/swap/{}/lightning", self.base_url, source_network);
        self.post_json(&url, request).await
    }

    /// Claim a swap via Gelato relay.
    pub async fn claim_gelato(&self, swap_id: &str, secret: &str) -> Result<()> {
        let url = format!("{}/swap/{}/claim-gelato", self.base_url, swap_id);
        let request = ClaimGelatoRequest {
            secret: secret.to_string(),
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| Error::Network(format!("Failed to send request: {}", e)))?;

        if !response.status().is_success() {
            let error: ApiError = response.json().await.unwrap_or_else(|_| ApiError {
                error: "Unknown error".to_string(),
            });
            return Err(Error::Network(format!("Failed to claim: {}", error.error)));
        }

        Ok(())
    }

    /// Get API version information.
    pub async fn get_version(&self) -> Result<Version> {
        let url = format!("{}/version", self.base_url);
        self.get_json(&url).await
    }

    /// Recover swaps using extended public key.
    pub async fn recover_swaps(&self, xpub: &str) -> Result<RecoverSwapsResponse> {
        let url = format!("{}/swap/recover", self.base_url);
        let request = RecoverSwapsRequest {
            xpub: xpub.to_string(),
        };
        self.post_json(&url, &request).await
    }

    // Helper methods

    async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| Error::Network(format!("Failed to send request to {}: {}", url, e)))?;

        if !response.status().is_success() {
            let error: ApiError = response.json().await.unwrap_or_else(|_| ApiError {
                error: "Unknown error".to_string(),
            });
            return Err(Error::Network(format!("API error: {}", error.error)));
        }

        let text = response
            .text()
            .await
            .map_err(|e| Error::Network(format!("Failed to read response: {}", e)))?;

        log::debug!("GET {} response: {}", url, text);

        serde_json::from_str(&text)
            .map_err(|e| Error::Parse(format!("Failed to parse response: {}. Body: {}", e, text)))
    }

    async fn post_json<T: serde::de::DeserializeOwned, R: serde::Serialize>(
        &self,
        url: &str,
        body: &R,
    ) -> Result<T> {
        let response = self
            .client
            .post(url)
            .json(body)
            .send()
            .await
            .map_err(|e| Error::Network(format!("Failed to send request to {}: {}", url, e)))?;

        if !response.status().is_success() {
            let error: ApiError = response.json().await.unwrap_or_else(|_| ApiError {
                error: "Unknown error".to_string(),
            });
            return Err(Error::Network(format!("API error: {}", error.error)));
        }

        let text = response
            .text()
            .await
            .map_err(|e| Error::Network(format!("Failed to read response: {}", e)))?;

        log::debug!("POST {} response: {}", url, text);

        serde_json::from_str(&text)
            .map_err(|e| Error::Parse(format!("Failed to parse response: {}. Body: {}", e, text)))
    }
}

#[cfg(test)]
pub mod tests {
    use crate::ApiClient;
    use crate::api::{QuoteRequest, TokenId};

    #[ignore]
    #[tokio::test]
    pub async fn manual_api_checks() {
        let client = ApiClient::new("http://localhost:3333");

        client.health_check().await.unwrap();

        client.get_tokens().await.unwrap();

        client.get_asset_pairs().await.unwrap();

        client
            .get_quote(&QuoteRequest {
                from: TokenId::BtcLightning,
                to: TokenId::usdc_eth(),
                base_amount: 10000,
            })
            .await
            .unwrap();
    }
}
