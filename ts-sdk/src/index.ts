/**
 * Lendaswap Client SDK for TypeScript/JavaScript.
 *
 * This SDK provides a high-level interface for interacting with Lendaswap
 * Bitcoin-to-USDC atomic swaps.
 *
 * @example
 * ```typescript
 * import {
 *   Client,
 *   createDexieWalletStorage,
 *   createDexieSwapStorage,
 * } from '@lendaswap/sdk';
 *
 * // Create storage providers using Dexie (IndexedDB)
 * const walletStorage = createDexieWalletStorage();
 * const swapStorage = createDexieSwapStorage();
 *
 * // Create client
 * const client = await Client.create(
 *   'https://api.lendaswap.com',
 *   walletStorage,
 *   swapStorage,
 *   'bitcoin',
 *   'https://arkade.computer'
 * );
 *
 * // Initialize wallet (generates mnemonic if needed)
 * await client.init();
 *
 * // Get asset pairs
 * const pairs = await client.getAssetPairs();
 * ```
 *
 * @packageDocumentation
 */

// Re-export WASM types that are commonly used
// Storage provider types for Client.create()
export type {
  QuoteResponse,
  QuoteResponseInfo,
  SwapStorageProvider,
  TokenInfo,
  Version,
  VersionInfo,
  WalletStorageProvider,
} from "./api.js";
// API client
export {
  type AssetPair,
  type BtcToEvmSwapResponse,
  type Chain,
  Client,
  type EvmToArkadeSwapRequest,
  type EvmToBtcSwapResponse,
  type EvmToLightningSwapRequest,
  type ExtendedSwapStorageData,
  type GelatoSubmitRequest,
  type GelatoSubmitResponse,
  type GetSwapResponse,
  type QuoteRequest,
  type RecoveredSwap,
  type RecoverSwapsResponse,
  type SwapCommonFields,
  type SwapRequest,
  type SwapStatus,
  TokenId,
  type TokenIdString,
} from "./api.js";
// Price feed
export {
  PriceFeedService,
  type PriceTiers,
  type PriceUpdateCallback,
  type PriceUpdateMessage,
  type TradingPairPrices,
} from "./price-feed.js";
// Storage (wallet data)
// Swap storage (typed swap data using Dexie/IndexedDB)
// Wallet storage (typed wallet data using Dexie/IndexedDB)
export {
  createDexieSwapStorage,
  createDexieWalletStorage,
  DexieSwapStorageProvider,
  DexieWalletStorageProvider,
  STORAGE_KEYS,
} from "./storage/index.js";
// Types
export type { Network, SwapData, SwapParams, VhtlcAmounts } from "./types.js";
