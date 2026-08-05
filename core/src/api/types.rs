//! API types for the Lendaswap backend.
//!
//! These types match the backend API schema and are used for request/response serialization.

use rust_decimal::Decimal;
use serde::Deserialize;
use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

/// Token identifier for supported assets.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenId {
    BtcLightning,
    BtcArkade,
    BtcOnchain,
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
            TokenId::BtcOnchain => "btc_onchain",
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
    Bitcoin,
    Polygon,
    Ethereum,
    Arbitrum,
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

/// Response from the /tokens endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenInfos {
    pub btc_tokens: Vec<TokenInfo>,
    pub evm_tokens: Vec<TokenInfo>,
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
    /// - → `ClientFundedingSeen`: Client tx has been seen but not confirmed yet
    /// - → `ClientFunded`: Client sends BTC to server and confirmed
    /// - → `Expired`: No funding within 30 minutes
    Pending,

    /// Client's tx has been seen but not confirmed. This is mostly relevant for on-chain
    /// transactions but not for Arkade or Lightning
    ///
    /// Server has received and verified the BTC payment. We are still waiting for this transaction
    /// to be confirmed
    ///
    /// **Transitions:**
    /// - → `ClientFunded`: Client sends BTC to server and confirmed
    /// - → `ClientRefunded`: Client refunds BTC before server creates HTLC
    ClientFundingSeen,

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

/// Request to create an Arkade/Lightning to EVM swap (BTC → Token).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BtcToEvmSwapRequest {
    pub source_amount: Option<u64>,
    pub target_address: String,
    pub target_amount: Option<Decimal>,
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
    /// Timestamp past which refund is permitted on the EVM chain
    pub evm_refund_locktime: u32,
    /// Timestamp past which refund is permitted on Arkade
    pub vhtlc_refund_locktime: u32,
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
    /// Token being sent (source)
    pub source_token: TokenId,
    /// Token being received (target)
    pub target_token: TokenId,
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
    /// Deprecated: please use [`source_amount`]
    #[deprecated(note = "please use source_amount instead")]
    pub sats_receive: i64,
    /// Bitcoin HTLC claim transaction ID
    pub bitcoin_htlc_claim_txid: Option<String>,
    /// Bitcoin HTLC fund transaction ID
    pub bitcoin_htlc_fund_txid: Option<String>,
    /// EVM HTLC claim transaction ID
    pub evm_htlc_claim_txid: Option<String>,
    /// EVM HTLC fund transaction ID
    pub evm_htlc_fund_txid: Option<String>,
    /// Amount user will receive of target asset. Falls back to common.asset_amount if not present.
    #[serde(default)]
    pub target_amount: Option<f64>,
    /// Amount user must send in satoshis. Falls back to sats_receive if not present.
    #[serde(default)]
    pub source_amount: Option<u64>,
}

impl BtcToEvmSwapResponse {
    /// Returns the target amount (amount user will receive).
    /// Uses `target_amount` if present, otherwise falls back to deprecated `asset_amount`.
    pub fn target_amount(&self) -> f64 {
        self.target_amount.unwrap_or(self.common.asset_amount)
    }

    /// Returns the source amount in satoshis (amount user must send).
    /// Uses `source_amount` if present, otherwise falls back to deprecated `sats_receive`.
    #[allow(deprecated)]
    pub fn source_amount(&self) -> u64 {
        self.source_amount.unwrap_or(self.sats_receive as u64)
    }
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
    /// Net satoshis user will receive
    /// Deprecated: please use [`target_amount`]
    #[deprecated(note = "please use target_amount instead")]
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
    /// Amount the user will receive in sats
    pub target_amount: u64,
    /// Amount user must send of the source asset
    pub source_amount: f64,
}

/// Swap direction discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SwapDirection {
    BtcToEvm,
    EvmToBtc,
    BtcToArkade,
    OnchainToEvm,
    ArkadeToEvm,
}

/// Tagged union for swap responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "direction", rename_all = "snake_case")]
pub enum GetSwapResponse {
    BtcToEvm(BtcToEvmSwapResponse),
    EvmToBtc(EvmToBtcSwapResponse),
    BtcToArkade(BtcToArkadeSwapResponse),
    OnchainToEvm(OnchainToEvmSwapResponse),
    ArkadeToEvm(ArkadeToEvmSwapResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvmChain {
    Ethereum,
    Polygon,
    Arbitrum,
}

impl std::fmt::Display for EvmChain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EvmChain::Ethereum => write!(f, "ethereum"),
            EvmChain::Polygon => write!(f, "polygon"),
            EvmChain::Arbitrum => write!(f, "arbitrum"),
        }
    }
}

impl std::str::FromStr for EvmChain {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "ethereum" => Ok(EvmChain::Ethereum),
            "polygon" => Ok(EvmChain::Polygon),
            "arbitrum" => Ok(EvmChain::Arbitrum),
            _ => Err(format!(
                "Unknown EVM chain: '{}'. Expected 'ethereum', 'polygon', or 'arbitrum'",
                s
            )),
        }
    }
}

impl GetSwapResponse {
    /// Get the common fields regardless of swap direction.
    ///
    /// Note: Only available for BtcToEvm and EvmToBtc swaps.
    /// BtcToArkade and OnchainToEvm swaps have different structures.
    pub fn common(&self) -> Option<&SwapCommonFields> {
        match self {
            GetSwapResponse::BtcToEvm(r) => Some(&r.common),
            GetSwapResponse::EvmToBtc(r) => Some(&r.common),
            GetSwapResponse::BtcToArkade(_) => None,
            GetSwapResponse::OnchainToEvm(_) => None,
            GetSwapResponse::ArkadeToEvm(_) => None,
        }
    }

    /// Get the swap ID.
    pub fn id(&self) -> String {
        match self {
            GetSwapResponse::BtcToEvm(r) => r.common.id.to_string(),
            GetSwapResponse::EvmToBtc(r) => r.common.id.to_string(),
            GetSwapResponse::BtcToArkade(r) => r.id.to_string(),
            GetSwapResponse::OnchainToEvm(r) => r.id.to_string(),
            GetSwapResponse::ArkadeToEvm(r) => r.id.to_string(),
        }
    }

    /// Get the swap status.
    pub fn status(&self) -> SwapStatus {
        match self {
            GetSwapResponse::BtcToEvm(r) => r.common.status,
            GetSwapResponse::EvmToBtc(r) => r.common.status,
            GetSwapResponse::BtcToArkade(r) => r.status,
            GetSwapResponse::OnchainToEvm(r) => r.status,
            GetSwapResponse::ArkadeToEvm(r) => r.status,
        }
    }

    /// Get the direction of the swap.
    pub fn direction(&self) -> SwapDirection {
        match self {
            GetSwapResponse::BtcToEvm(_) => SwapDirection::BtcToEvm,
            GetSwapResponse::EvmToBtc(_) => SwapDirection::EvmToBtc,
            GetSwapResponse::BtcToArkade(_) => SwapDirection::BtcToArkade,
            GetSwapResponse::OnchainToEvm(_) => SwapDirection::OnchainToEvm,
            GetSwapResponse::ArkadeToEvm(_) => SwapDirection::ArkadeToEvm,
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

/// Request to create an on-chain Bitcoin to Arkade swap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BtcToArkadeSwapRequest {
    /// User's target Arkade address to receive VTXOs.
    pub target_arkade_address: String,
    /// Amount user wants to receive on Arkade in satoshis.
    pub sats_receive: i64,
    /// User's claim public key for the Arkade VHTLC.
    pub claim_pk: String,
    /// User's refund public key for the on-chain Bitcoin HTLC.
    pub refund_pk: String,
    /// Hash lock (32-byte hex string, no 0x prefix).
    pub hash_lock: String,
    /// User ID derived from wallet for recovery.
    pub user_id: String,
    /// Optional referral code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral_code: Option<String>,
}

/// BTC (on-chain) to Arkade swap response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BtcToArkadeSwapResponse {
    /// Swap ID.
    pub id: Uuid,
    /// Current status of the swap.
    pub status: SwapStatus,
    /// P2WSH HTLC address for user to send on-chain BTC.
    pub btc_htlc_address: String,
    /// Amount user must send in satoshis (includes fee).
    pub asset_amount: i64,
    /// Amount user will receive on Arkade in satoshis.
    /// Deprecated: please use [`target_amount`]
    pub sats_receive: i64,
    /// Protocol fee in satoshis.
    pub fee_sats: i64,
    /// Hash lock.
    pub hash_lock: String,
    /// Timestamp after which user can refund on-chain BTC.
    pub btc_refund_locktime: i64,
    /// Arkade VHTLC address where user will claim funds.
    pub arkade_vhtlc_address: String,
    /// User's target Arkade address.
    pub target_arkade_address: String,
    /// On-chain BTC funding transaction ID.
    pub btc_fund_txid: Option<String>,
    /// On-chain BTC claim transaction ID.
    pub btc_claim_txid: Option<String>,
    /// Arkade VHTLC funding transaction ID.
    pub arkade_fund_txid: Option<String>,
    /// Arkade VHTLC claim transaction ID.
    pub arkade_claim_txid: Option<String>,
    /// Bitcoin network.
    pub network: String,
    /// Timestamp of when the swap was created.
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,

    // VHTLC parameters for client-side claim
    /// Server's VHTLC public key (sender in the VHTLC).
    pub server_vhtlc_pk: String,
    /// Arkade server's public key.
    pub arkade_server_pk: String,
    /// VHTLC refund locktime (unix timestamp).
    pub vhtlc_refund_locktime: i64,
    /// Unilateral claim delay in seconds.
    pub unilateral_claim_delay: i64,
    /// Unilateral refund delay in seconds.
    pub unilateral_refund_delay: i64,
    /// Unilateral refund without receiver delay in seconds.
    pub unilateral_refund_without_receiver_delay: i64,
    /// Source token (always btc_onchain for this swap type).
    pub source_token: TokenId,
    /// Target token (always btc_arkade for this swap type).
    pub target_token: TokenId,
    /// Amount the user will receive
    pub target_amount: u64,
    /// Amount user must send in satoshis
    pub source_amount: u64,
}

/// Request to create an on-chain Bitcoin to EVM swap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnchainToEvmSwapRequest {
    /// User's target EVM address to receive tokens.
    pub target_address: String,
    /// Amount user wants to send in satoshis.
    pub source_amount: u64,
    /// Target token (e.g., "usdc_pol", "usdt_pol").
    pub target_token: TokenId,
    /// Hash lock (32-byte SHA256 hex string with 0x prefix).
    pub hash_lock: String,
    /// User's refund public key for the on-chain Bitcoin HTLC.
    pub refund_pk: String,
    /// User ID derived from wallet for recovery.
    pub user_id: String,
    /// Optional referral code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral_code: Option<String>,
}

/// On-chain BTC to EVM swap response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnchainToEvmSwapResponse {
    /// Swap ID.
    pub id: Uuid,
    /// Current status of the swap.
    pub status: SwapStatus,
    /// On-chain Bitcoin HTLC address (Taproot P2TR).
    pub btc_htlc_address: String,
    /// Protocol fee in satoshis.
    pub fee_sats: i64,
    /// The server's pk inside the htlc
    pub btc_server_pk: String,
    /// Hash lock (32-byte hex)
    ///
    /// To be used for EVM htlc
    pub evm_hash_lock: String,
    /// Hash lock (20-byte hex)
    ///
    /// To be used for bitcoin htlc. This is the [`ripemd160(evm_hash_lock)`]
    pub btc_hash_lock: String,
    /// On-chain BTC refund locktime (unix timestamp).
    pub btc_refund_locktime: i64,
    /// On-chain funding transaction ID.
    pub btc_fund_txid: Option<String>,
    /// On-chain claim transaction ID (server claim).
    pub btc_claim_txid: Option<String>,
    /// EVM HTLC fund transaction ID.
    pub evm_fund_txid: Option<String>,
    /// EVM HTLC claim transaction ID (user claim).
    pub evm_claim_txid: Option<String>,
    /// Bitcoin network.
    pub network: String,
    /// Timestamp of when the swap was created.
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// EVM chain (e.g., "Polygon", "Ethereum").
    pub chain: String,
    /// Client's EVM address (where tokens will be received).
    pub client_evm_address: String,
    /// EVM HTLC contract address.
    pub evm_htlc_address: String,
    /// Server's EVM address.
    pub server_evm_address: String,
    /// EVM HTLC refund locktime (unix timestamp).
    pub evm_refund_locktime: i64,
    /// Source token (e.g., btc_onchain).
    pub source_token: TokenId,
    /// Target token (e.g., usdc_pol).
    pub target_token: TokenId,
    /// How much the user will receive of the target asset
    pub target_amount: f64,
    /// Amount user must send in satoshis
    pub source_amount: u64,
}

// ============================================================================
// Arkade-to-EVM Swap Types (chain-agnostic endpoint)
// ============================================================================

/// Token summary returned in Arkade-to-EVM creation responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenSummary {
    pub address: String,
    pub symbol: String,
    pub decimals: u32,
}

/// DEX swap calldata for the coordinator contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DexCallData {
    pub to: String,
    pub data: String,
    pub value: String,
}

/// Request to create an Arkade-to-EVM swap via the chain-agnostic endpoint.
///
/// Uses `evm_chain_id` + `token_address` instead of per-chain paths.
/// Supports any token reachable through 1inch aggregation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArkadeToEvmSwapRequest {
    /// Target EVM address to receive the tokens.
    pub target_address: String,
    /// Numeric EVM chain ID (1 = Ethereum, 137 = Polygon, 42161 = Arbitrum).
    pub evm_chain_id: u64,
    /// ERC-20 contract address of the desired token on the target chain.
    pub token_address: String,
    /// How many sats the user wants to send (mutually exclusive with `amount_out`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_in: Option<u64>,
    /// How much target token the user wants to receive (mutually exclusive with `amount_in`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_out: Option<u64>,
    /// Hash lock (32-byte hex string with 0x prefix).
    pub hash_lock: String,
    /// Arkade HTLC script version. New swaps must use version 1.
    pub arkade_htlc_script_version: i64,
    /// Refund public key for the Arkade VHTLC.
    pub refund_pk: String,
    /// User ID for recovery purposes.
    pub user_id: String,
    /// Optional referral code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral_code: Option<String>,
}

/// Response from creating an Arkade-to-EVM swap (creation endpoint).
///
/// This is the response from `POST /swap/arkade/evm`. It uses `TokenSummary`
/// objects for source/target tokens and includes `dex_call_data`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArkadeToEvmSwapCreateResponse {
    pub id: Uuid,
    pub status: SwapStatus,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub evm_chain_id: u64,
    pub chain: String,
    pub source_token: TokenSummary,
    pub target_token: TokenSummary,
    pub btc_expected_sats: i64,
    pub evm_expected_sats: i64,
    pub target_amount: u64,
    pub fee_sats: i64,
    pub hash_lock: String,
    pub btc_vhtlc_address: String,
    /// HTLCErc20 contract address.
    pub evm_htlc_address: String,
    /// HTLCCoordinator contract address.
    pub evm_coordinator_address: String,
    pub server_evm_address: String,
    pub evm_refund_locktime: u64,
    pub sender_pk: String,
    pub receiver_pk: String,
    pub arkade_server_pk: String,
    pub network: String,
    pub vhtlc_refund_locktime: u64,
    pub unilateral_claim_delay: i64,
    pub unilateral_refund_delay: i64,
    pub unilateral_refund_without_receiver_delay: i64,
    /// DEX swap calldata for non-WBTC targets.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dex_call_data: Option<DexCallData>,
}

/// Arkade → EVM swap response (from get_swap endpoint).
///
/// This matches the `GetSwapResponse::ArkadeToEvm` variant returned by
/// `GET /swap/{id}`. Uses `TokenId` strings instead of `TokenSummary` objects.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArkadeToEvmSwapResponse {
    pub id: Uuid,
    pub status: SwapStatus,
    pub fee_sats: i64,
    pub hash_lock: String,
    pub source_token: TokenId,
    pub target_token: TokenId,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub chain: String,
    pub evm_chain_id: i64,
    pub target_token_address: String,
    pub target_token_symbol: String,
    pub target_token_decimals: i64,
    pub btc_expected_sats: i64,
    pub evm_expected_sats: i64,
    pub target_amount: Option<i64>,
    pub btc_vhtlc_address: String,
    pub btc_fund_txid: Option<String>,
    pub btc_claim_txid: Option<String>,
    /// HTLCErc20 contract address.
    pub evm_htlc_address: String,
    /// HTLCCoordinator contract address.
    pub evm_coordinator_address: String,
    pub client_evm_address: String,
    pub server_evm_address: String,
    pub evm_fund_txid: Option<String>,
    pub evm_claim_txid: Option<String>,
    pub evm_refund_locktime: i64,
    pub sender_pk: String,
    pub receiver_pk: String,
    pub arkade_server_pk: String,
    pub vhtlc_refund_locktime: i64,
    pub unilateral_claim_delay: i64,
    pub unilateral_refund_delay: i64,
    pub unilateral_refund_without_receiver_delay: i64,
    pub network: String,
    /// WBTC contract address (the token locked in the HTLC).
    pub wbtc_address: String,
    /// DEX swap calldata for non-WBTC targets.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dex_call_data: Option<DexCallData>,
}

// ============================================================================
// Collaborative Refund types
// ============================================================================

/// Request for collaborative refund of spendable VTXOs.
#[derive(Debug, Serialize, Deserialize)]
pub struct CollabRefundRequest {
    pub ark_tx: String,
    pub checkpoint_txs: Vec<String>,
}

/// Response with countersigned PSBTs for spendable VTXOs.
#[derive(Debug, Serialize, Deserialize)]
pub struct CollabRefundResponse {
    pub ark_tx: String,
    pub checkpoint_txs: Vec<String>,
}

/// Request for collaborative refund of recoverable VTXOs (delegate flow).
#[derive(Debug, Serialize, Deserialize)]
pub struct CollabRefundDelegateRequest {
    pub intent_proof: String,
    pub forfeit_psbts: Vec<String>,
}

/// Response with countersigned delegate PSBTs for recoverable VTXOs.
#[derive(Debug, Serialize, Deserialize)]
pub struct CollabRefundDelegateResponse {
    pub intent_proof: String,
    pub forfeit_psbts: Vec<String>,
}

// ============================================================================
// Delegate types
// ============================================================================

/// Response containing the delegate cosigner public key.
#[derive(Debug, Serialize, Deserialize)]
pub struct CosignerPkResponse {
    pub cosigner_pk: String,
}

/// Request to settle a delegated batch.
#[derive(Debug, Serialize, Deserialize)]
pub struct SettleDelegateRequest {
    pub intent_proof: String,
    pub intent_message: String,
    pub forfeit_psbts: Vec<String>,
    pub cosigner_pk: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub swap_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preimage: Option<String>,
}

/// Response from delegate settlement.
#[derive(Debug, Serialize, Deserialize)]
pub struct SettleDelegateResponse {
    pub commitment_txid: String,
}
