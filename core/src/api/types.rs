//! API types for the Lendaswap backend.
//!
//! These types match the backend API schema and are used for request/response serialization.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Token identifier for supported assets.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenId {
    BtcLightning,
    BtcArkade,
    /// Dynamic coin identifier for EVM tokens
    #[serde(untagged)]
    Coin(String),
}

impl TokenId {
    /// Get the string representation of the token ID.
    pub fn as_str(&self) -> &str {
        match self {
            TokenId::BtcLightning => "btc_lightning",
            TokenId::BtcArkade => "btc_arkade",
            TokenId::Coin(s) => s,
        }
    }
}

impl std::fmt::Display for TokenId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Blockchain network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Chain {
    Arkade,
    Lightning,
    Polygon,
    Ethereum,
}

/// Token information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenInfo {
    pub token_id: TokenId,
    pub symbol: String,
    pub chain: Chain,
    pub name: String,
    pub decimals: u8,
}

/// Asset pair for trading.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetPair {
    pub source: TokenInfo,
    pub target: TokenInfo,
}

/// Price response (legacy).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceResponse {
    pub usd_per_btc: f64,
}

/// Price tiers for different quote asset amounts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceTiers {
    /// Price per BTC when swapping 1 unit of the quote asset
    pub tier_1: f64,
    /// Price per BTC when swapping 100 units of the quote asset
    pub tier_100: f64,
    /// Price per BTC when swapping 1,000 units of the quote asset
    pub tier_1000: f64,
    /// Price per BTC when swapping 5,000 units of the quote asset
    pub tier_5000: f64,
}

/// Trading pair prices with tiers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradingPairPrices {
    /// e.g., "USDC_POL-BTC" or "USDT0_POL-BTC"
    pub pair: String,
    pub tiers: PriceTiers,
}

/// WebSocket price update message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceUpdateMessage {
    pub timestamp: u64,
    pub pairs: Vec<TradingPairPrices>,
}

/// Swap status state machine.
///
/// Normal flow:
///   pending → clientfunded → serverfunded → clientredeemed → serverredeemed
///
/// Refund flows:
///   pending → expired (no funding)
///   clientfunded → clientrefunded (before server funds)
///   serverfunded → clientfundedserverrefunded (HTLC timeout)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SwapStatus {
    /// Initial state when swap is created. Waiting for client to fund BTC.
    ///
    /// **Transitions:**
    /// - → `ClientFunded`: Client sends BTC to server
    /// - → `Expired`: No funding within 30 minutes
    Pending,

    /// Client has funded BTC (via Lightning or Arkade).
    ///
    /// Server has received and verified the BTC payment. Waiting for server
    /// to create the HTLC on Polygon.
    ///
    /// **Transitions:**
    /// - → `ServerFunded`: Server creates HTLC with hash lock
    /// - → `ClientRefunded`: Client refunds BTC before server creates HTLC
    ClientFunded,

    /// Client funded BTC but refunded before server created the HTLC.
    ///
    /// This can occur when:
    /// - Server was too slow to create the HTLC
    /// - Server encountered an error before creating HTLC
    /// - Client decided to cancel before server locked funds
    ///
    /// **Terminal state** - no further transitions.
    ClientRefunded,

    /// Server has locked WBTC in Polygon HTLC.
    ///
    /// The HTLC is locked with the client's hash lock. Client can now claim
    /// USDC by revealing the secret preimage.
    ///
    /// **Transitions:**
    /// - → `ClientRedeemed`: Client reveals secret and claims USDC
    /// - → `ClientFundedServerRefunded`: HTLC timeout expires
    ServerFunded,

    /// Client is claiming by revealing the secret.
    ///
    /// The transaction might not have been confirmed yet but the secret is now public on-chain.
    /// Server can use it to claim BTC.
    ///
    /// **Transitions:**
    /// - → `ClientRedeemed`: The transaction was successful
    /// - → `ServerRedeemed`: Server successfully claims BTC
    ClientRedeeming,

    /// Client has claimed USDC by revealing the secret on Polygon.
    ///
    /// The secret is now public on-chain. Server can use it to claim BTC.
    ///
    /// **Transitions:**
    /// - → `ServerRedeemed`: Server successfully claims BTC
    ClientRedeemed,

    /// Server has redeemed the BTC using the revealed secret.
    ///
    /// **Successful swap completion:**
    /// - Client received USDC
    /// - Server received BTC
    /// - Swap is complete
    ///
    /// **Terminal state** - no further transitions.
    ServerRedeemed,

    /// Client funded BTC, server locked WBTC, but HTLC timed out.
    ///
    /// This occurs when the Polygon HTLC timeout expires before the client
    /// claims. Server refunds the locked WBTC, and client keeps their BTC.
    ///
    /// **Terminal state** - no further transitions.
    ClientFundedServerRefunded,

    /// ⚠️ **CRITICAL ERROR STATE**
    ///
    /// Client has refunded their BTC while server still has WBTC locked.
    ///
    /// This state should **never** occur in a correctly implemented system.
    /// It indicates:
    /// - Bitcoin HTLC timeout is shorter than Polygon HTLC timeout (WRONG!)
    /// - Client was able to refund before Polygon timeout
    /// - If client knows the secret, they can steal both BTC and USDC
    ///
    /// **Recovery:**
    /// - Server must immediately refund Polygon HTLC
    /// - Investigate timeout configuration
    /// - Check for protocol violations
    ///
    /// **Transitions:**
    /// - → `ClientRefundedServerRefunded`: Server refunds HTLC
    ClientRefundedServerFunded,

    /// Both parties have refunded their HTLCs after error state.
    ///
    /// Reached after recovering from `ClientRefundedServerFunded` error state.
    /// Both client and server have their original funds.
    ///
    /// **Terminal state** - no further transitions.
    ClientRefundedServerRefunded,

    /// Swap expired before client funded.
    ///
    /// No funds were ever locked. Swap timed out in `Pending` state
    /// (default timeout: 30 minutes).
    ///
    /// **Terminal state** - no further transitions.
    Expired,

    /// Invalid Funded
    ///
    /// The swap was funded but with wrong parameters, e.g. wrong amount, target address, etc.
    /// We assume the server never gets into this stage, so only the client (who always funds
    /// first) funded and needs to refund now
    ///
    /// **Transitions:**
    /// - → `ClientRefunded`: Client needs to refund
    ClientInvalidFunded,

    /// Client funded too late and lightning invoice has expired
    ///
    /// The client funded the swap but the lightning invoice expired before we could pay for it.
    /// The client will need to refund
    ///
    /// **Transitions:**
    /// - → `ClientRefunded`: Client needs to refund
    ClientFundedTooLate,

    /// This is an error state
    ///
    /// A client was able to refund and redeem which means he took all the money
    ClientRedeemedAndClientRefunded,
}

/// Request to create an Arkade to EVM swap (BTC → Token).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapRequest {
    pub target_address: String,
    pub target_amount: Decimal,
    pub target_token: TokenId,
    pub hash_lock: String,
    pub refund_pk: String,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral_code: Option<String>,
}

/// Request to create an EVM to Arkade swap (Token → BTC).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvmToArkadeSwapRequest {
    pub target_address: String,
    pub source_amount: Decimal,
    pub source_token: TokenId,
    pub hash_lock: String,
    pub receiver_pk: String,
    pub user_address: String,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral_code: Option<String>,
}

/// Request to create an EVM to Lightning swap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvmToLightningSwapRequest {
    pub bolt11_invoice: String,
    pub source_token: TokenId,
    pub user_address: String,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral_code: Option<String>,
}

/// Common fields shared across all swap directions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapCommonFields {
    /// Unique swap identifier
    pub id: Uuid,
    /// Current status of the swap
    pub status: SwapStatus,
    /// Hash lock for the HTLC (32-byte hex string with 0x prefix)
    pub hash_lock: String,
    /// Protocol fee amount in satoshis
    pub fee_sats: i64,
    /// Asset amount for the swap, i.e. for EVM-to-BTC it's the EVM's asset's amount
    pub asset_amount: f64,
    /// Client's public key (refund_pk or claim_pk)
    pub sender_pk: String,
    /// Lendaswap's public key
    pub receiver_pk: String,
    /// Arkade server's public key
    pub server_pk: String,
    /// Timestamp past which refund is permitted
    pub refund_locktime: u32,
    /// Relative timelock for claim in seconds
    pub unilateral_claim_delay: i64,
    /// Relative timelock for refund in seconds
    pub unilateral_refund_delay: i64,
    /// Relative timelock for refund without receiver in seconds
    pub unilateral_refund_without_receiver_delay: i64,
    /// Bitcoin network (e.g., "signet", "mainnet")
    pub network: String,
    /// Timestamp of when the swap was created
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// BTC → EVM swap response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BtcToEvmSwapResponse {
    #[serde(flatten)]
    pub common: SwapCommonFields,
    /// EVM HTLC contract address
    pub htlc_address_evm: String,
    /// Arkade VHTLC address
    pub htlc_address_arkade: String,
    /// User's EVM address to receive tokens
    pub user_address_evm: String,
    /// Lightning invoice for payment
    pub ln_invoice: String,
    /// The amount of satoshis we expect to receive
    pub sats_receive: i64,
    /// Token being sent (source)
    pub source_token: TokenId,
    /// Token being received (target)
    pub target_token: TokenId,
    /// Bitcoin HTLC claim transaction ID
    pub bitcoin_htlc_claim_txid: Option<String>,
    /// Bitcoin HTLC fund transaction ID
    pub bitcoin_htlc_fund_txid: Option<String>,
    /// EVM HTLC claim transaction ID
    pub evm_htlc_claim_txid: Option<String>,
    /// EVM HTLC fund transaction ID
    pub evm_htlc_fund_txid: Option<String>,
}

/// EVM → BTC swap response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvmToBtcSwapResponse {
    #[serde(flatten)]
    pub common: SwapCommonFields,
    /// EVM HTLC contract address
    pub htlc_address_evm: String,
    /// Arkade VHTLC address
    pub htlc_address_arkade: String,
    /// User's EVM address sending tokens
    pub user_address_evm: String,
    /// User's Arkade address to receive BTC (optional)
    pub user_address_arkade: Option<String>,
    /// Lightning invoice for payment
    pub ln_invoice: String,
    /// Token being sent (source)
    pub source_token: TokenId,
    /// Token being received (target)
    pub target_token: TokenId,
    /// Net satoshis user will receive
    pub sats_receive: i64,
    /// Bitcoin HTLC fund transaction ID
    pub bitcoin_htlc_fund_txid: Option<String>,
    /// Bitcoin HTLC claim transaction ID
    pub bitcoin_htlc_claim_txid: Option<String>,
    /// EVM HTLC claim transaction ID
    pub evm_htlc_claim_txid: Option<String>,
    /// EVM HTLC fund transaction ID
    pub evm_htlc_fund_txid: Option<String>,
    /// Create swap transaction hash
    pub create_swap_tx: Option<String>,
    /// Token approval transaction hash
    pub approve_tx: Option<String>,
    /// Gelato forwarder contract address
    pub gelato_forwarder_address: Option<String>,
    /// Gelato user nonce for replay protection
    pub gelato_user_nonce: Option<String>,
    /// Gelato user deadline timestamp
    pub gelato_user_deadline: Option<String>,
    /// ERC20 token address for approve target
    pub source_token_address: String,
}

/// Swap direction discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SwapDirection {
    BtcToEvm,
    EvmToBtc,
}

/// Tagged union for swap responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "direction", rename_all = "snake_case")]
pub enum GetSwapResponse {
    BtcToEvm(BtcToEvmSwapResponse),
    EvmToBtc(EvmToBtcSwapResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvmChain {
    Ethereum,
    Polygon,
}

impl std::fmt::Display for EvmChain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EvmChain::Ethereum => write!(f, "ethereum"),
            EvmChain::Polygon => write!(f, "polygon"),
        }
    }
}

impl std::str::FromStr for EvmChain {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "ethereum" => Ok(EvmChain::Ethereum),
            "polygon" => Ok(EvmChain::Polygon),
            _ => Err(format!(
                "Unknown EVM chain: '{}'. Expected 'ethereum' or 'polygon'",
                s
            )),
        }
    }
}

impl GetSwapResponse {
    /// Get the common fields regardless of swap direction.
    pub fn common(&self) -> &SwapCommonFields {
        match self {
            GetSwapResponse::BtcToEvm(r) => &r.common,
            GetSwapResponse::EvmToBtc(r) => &r.common,
        }
    }

    /// Get the swap ID.
    pub fn id(&self) -> String {
        self.common().id.to_string()
    }

    /// Get the swap status.
    pub fn status(&self) -> SwapStatus {
        self.common().status
    }

    /// Get the direction of the swap.
    pub fn direction(&self) -> SwapDirection {
        match self {
            GetSwapResponse::BtcToEvm(_) => SwapDirection::BtcToEvm,
            GetSwapResponse::EvmToBtc(_) => SwapDirection::EvmToBtc,
        }
    }
}

/// Gelato relay submit request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GelatoSubmitRequest {
    pub create_swap_signature: String,
    pub user_nonce: String,
    pub user_deadline: String,
}

/// Gelato relay submit response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GelatoSubmitResponse {
    pub create_swap_task_id: String,
    pub message: String,
}

/// Version information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub tag: String,
    pub commit_hash: String,
}

/// Quote request parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuoteRequest {
    pub from: TokenId,
    pub to: TokenId,
    /// Amount in satoshis
    pub base_amount: u64,
}

/// Quote response with exchange rate and fees.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuoteResponse {
    /// Exchange rate: how much fiat you get/pay per BTC
    pub exchange_rate: String,
    /// Network fee estimate (in satoshis)
    pub network_fee: u64,
    /// Protocol fee (in satoshis)
    pub protocol_fee: u64,
    /// Protocol fee rate (as decimal, e.g., 0.0025 = 0.25%)
    pub protocol_fee_rate: f64,
    /// Minimum swap amount in satoshis
    pub min_amount: u64,
    /// Maximum swap amount in satoshis
    pub max_amount: u64,
}

/// Claim request for Gelato relay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimGelatoRequest {
    pub secret: String,
}

/// Recover swaps request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoverSwapsRequest {
    pub xpub: String,
}

/// Recovered swap with index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveredSwap {
    #[serde(flatten)]
    pub swap: GetSwapResponse,
    pub index: u32,
}

/// Recover swaps response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoverSwapsResponse {
    pub swaps: Vec<RecoveredSwap>,
    pub highest_index: u32,
}

/// API error response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiError {
    pub error: String,
}

// ============================================================================
// VTXO Swap Types
// ============================================================================

/// VTXO swap status for BTC-to-BTC (Arkade refresh) swaps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VtxoSwapStatus {
    /// Initial state. Waiting for client to fund their VHTLC.
    Pending,
    /// Client has funded their VHTLC. Server should fund now.
    ClientFunded,
    /// Server has funded their VHTLC. Client can claim.
    ServerFunded,
    /// Client has claimed server's VHTLC (preimage revealed).
    ClientRedeemed,
    /// Server has claimed client's VHTLC. Swap complete.
    ServerRedeemed,
    /// Client refunded before server funded.
    ClientRefunded,
    /// Server refunded after timeout (client funded but didn't claim).
    ClientFundedServerRefunded,
    /// Swap expired (no client funding).
    Expired,
}

/// Request to estimate VTXO swap fee.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstimateVtxoSwapRequest {
    /// List of VTXO outpoints to refresh ("txid:vout" format)
    pub vtxos: Vec<String>,
}

/// Response from VTXO swap estimation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstimateVtxoSwapResponse {
    /// Total fee in satoshis
    pub fee_sats: i64,
    /// Total input amount in satoshis
    pub total_input_sats: i64,
    /// Amount user will receive (total_input_sats - fee_sats)
    pub output_sats: i64,
    /// Number of VTXOs being refreshed
    pub vtxo_count: usize,
    /// Expected expiry timestamp (Unix) of the resulting VTXOs.
    /// This is the minimum expiry among the server's VTXOs that will be used to fund the swap.
    pub expected_vtxo_expiry: i64,
}

/// Request to create a VTXO swap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVtxoSwapRequest {
    /// List of VTXO outpoints to refresh
    pub vtxos: Vec<String>,
    /// SHA256(preimage) - client generates the secret
    pub preimage_hash: String,
    /// Client's public key for the VHTLC
    pub client_pk: String,
    /// User ID for recovery purposes
    pub user_id: String,
}

/// Response from creating/getting a VTXO swap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VtxoSwapResponse {
    /// Swap ID
    pub id: Uuid,
    /// Swap status
    pub status: VtxoSwapStatus,
    /// Creation timestamp
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,

    // Client VHTLC params (client funds this first)
    /// Client's VHTLC address
    pub client_vhtlc_address: String,
    /// Amount client should fund in satoshis
    pub client_fund_amount_sats: i64,
    /// Client's public key
    pub client_pk: String,
    /// Client VHTLC locktime (Unix timestamp)
    pub client_locktime: u64,
    /// Client claim delay in seconds
    pub client_unilateral_claim_delay: i64,
    /// Client refund delay in seconds
    pub client_unilateral_refund_delay: i64,
    /// Client refund without receiver delay in seconds
    pub client_unilateral_refund_without_receiver_delay: i64,

    // Server VHTLC params (server funds after client)
    /// Server's VHTLC address
    pub server_vhtlc_address: String,
    /// Amount server will fund in satoshis
    pub server_fund_amount_sats: i64,
    /// Server's public key
    pub server_pk: String,
    /// Server VHTLC locktime (Unix timestamp)
    pub server_locktime: u64,
    /// Server claim delay in seconds
    pub server_unilateral_claim_delay: i64,
    /// Server refund delay in seconds
    pub server_unilateral_refund_delay: i64,
    /// Server refund without receiver delay in seconds
    pub server_unilateral_refund_without_receiver_delay: i64,

    // Common params
    /// Arkade server's public key
    pub arkade_server_pk: String,
    /// The preimage hash (SHA256)
    pub preimage_hash: String,
    /// Fee in satoshis
    pub fee_sats: i64,
    /// Bitcoin network
    pub network: String,
}
