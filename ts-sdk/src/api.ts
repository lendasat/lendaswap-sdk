/**
 * API client wrapper for the Lendaswap REST API.
 *
 * This module provides a high-level TypeScript API that wraps the WASM-based
 * API client for easier use in TypeScript/JavaScript applications.
 */

// Import WASM types for internal use
import init, {
  JsSwapStorageProvider,
  JsWalletStorageProvider,
  Client as WasmClient,
  setLogLevel as wasmSetLogLevel,
  getLogLevel as wasmGetLogLevel,
} from "../wasm/lendaswap_wasm_sdk.js";
import type { VhtlcAmounts } from "./types.js";

// Cached initialization promise
let initPromise: Promise<void> | null = null;

/**
 * Initialize the WASM module.
 *
 * This is called automatically when creating a Wallet, but can be called
 * explicitly for eager initialization.
 *
 * @param wasmPath - Optional path to the WASM file (for Node.js environments)
 */
export async function initWasm(wasmPath?: string): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    // Check if we're in Node.js
    const isNode =
      typeof process !== "undefined" &&
      process.versions != null &&
      process.versions.node != null;

    if (isNode && !wasmPath) {
      // In Node.js, try to load the WASM file directly
      const { readFile } = await import("fs/promises");
      const { fileURLToPath } = await import("url");
      const { dirname, join } = await import("path");

      // Get the directory of the current module
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);

      // The WASM file is in the wasm directory relative to src
      const wasmFilePath = join(
        __dirname,
        "..",
        "wasm",
        "lendaswap_sdk_bg.wasm",
      );
      const wasmBuffer = await readFile(wasmFilePath);

      await init(wasmBuffer);
    } else if (wasmPath) {
      // Custom path provided
      const { readFile } = await import("fs/promises");
      const wasmBuffer = await readFile(wasmPath);
      await init(wasmBuffer);
    } else {
      // Browser environment - let init handle fetching
      await init();
    }
  })();

  return initPromise;
}

// Re-export WASM types directly
export {
  QuoteResponse,
  TokenId,
  Version,
  VhtlcAmounts,
} from "../wasm/lendaswap_wasm_sdk.js";

/**
 * Token identifier for supported assets.
 */
export type TokenIdString =
  | "btc_lightning"
  | "btc_arkade"
  | "usdc_pol"
  | "usdt0_pol"
  | "usdc_eth"
  | "usdt_eth";

/**
 * Blockchain network.
 */
export type Chain = "Bitcoin" | "Polygon" | "Ethereum" | "Lightning" | "Arkade";

/**
 * Token information returned from the API.
 * Note: serde serializes with snake_case, so we use snake_case here.
 */
export interface TokenInfo {
  token_id: TokenIdString;
  symbol: string;
  chain: Chain;
  name: string;
  decimals: number;
}

/**
 * Asset pair for trading.
 */
export interface AssetPair {
  source: TokenInfo;
  target: TokenInfo;
}

/**
 * Swap status enumeration.
 * These match the server-side status values.
 */
export type SwapStatus =
  | "pending"
  | "clientfunded"
  | "clientrefunded"
  | "serverfunded"
  | "clientredeeming"
  | "clientredeemed"
  | "serverredeemed"
  | "clientfundedserverrefunded"
  | "clientrefundedserverfunded"
  | "clientrefundedserverrefunded"
  | "expired"
  | "clientinvalidfunded"
  | "clientfundedtoolate";

/**
 * Common fields shared across all swap directions.
 * These fields are flattened into the response by serde.
 */
export interface SwapCommonFields {
  id: string;
  status: SwapStatus;
  hash_lock: string;
  fee_sats: number;
  usd_amount: number;
  sender_pk: string;
  receiver_pk: string;
  server_pk: string;
  refund_locktime: number;
  unilateral_claim_delay: number;
  unilateral_refund_delay: number;
  unilateral_refund_without_receiver_delay: number;
  network: string;
  created_at: string;
}

/**
 * BTC to EVM swap response.
 * Note: direction field is added by the SDK, not returned by the server.
 */
export interface BtcToEvmSwapResponse extends SwapCommonFields {
  direction: "btc_to_evm";
  htlc_address_evm: string;
  htlc_address_arkade: string;
  user_address_evm: string;
  ln_invoice: string;
  sats_receive: number;
  source_token: TokenIdString;
  target_token: TokenIdString;
  bitcoin_htlc_claim_txid: string | null;
  bitcoin_htlc_fund_txid: string | null;
  evm_htlc_claim_txid: string | null;
  evm_htlc_fund_txid: string | null;
}

/**
 * EVM to BTC swap response.
 * Note: direction field is added by the SDK, not returned by the server.
 */
export interface EvmToBtcSwapResponse extends SwapCommonFields {
  direction: "evm_to_btc";
  htlc_address_evm: string;
  htlc_address_arkade: string;
  user_address_evm: string;
  user_address_arkade: string | null;
  ln_invoice: string;
  source_token: TokenIdString;
  target_token: TokenIdString;
  sats_receive: number;
  bitcoin_htlc_fund_txid: string | null;
  bitcoin_htlc_claim_txid: string | null;
  evm_htlc_claim_txid: string | null;
  evm_htlc_fund_txid: string | null;
  create_swap_tx: string | null;
  approve_tx: string | null;
  gelato_forwarder_address: string | null;
  gelato_user_nonce: string | null;
  gelato_user_deadline: string | null;
  source_token_address: string;
}

/**
 * Union type for swap responses based on direction.
 */
export type GetSwapResponse = BtcToEvmSwapResponse | EvmToBtcSwapResponse;

/**
 * Swap parameters derived from the wallet for creating swaps.
 * Contains cryptographic keys and preimage data.
 */
export interface SwapParams {
  /** Secret key (hex-encoded) */
  secret_key: string;
  /** Public key (hex-encoded) */
  public_key: string;
  /** Preimage for the HTLC (32 bytes, hex-encoded) */
  preimage: string;
  /** Hash of the preimage (32 bytes, hex-encoded) */
  preimage_hash: string;
  /** User ID public key (hex-encoded) */
  user_id: string;
  /** Key derivation index */
  key_index: number;
}

/**
 * Extended swap storage data that includes the swap response and optional secret.
 * Used for persisting swap data locally with the preimage secret.
 */
export interface ExtendedSwapStorageData {
  // TODO: flatten this. No  need to return extended swap data
  response: GetSwapResponse;
  swap_params: SwapParams;
}

/**
 * Request to create an Arkade to EVM swap (BTC → Token).
 */
export interface SwapRequest {
  target_address: string;
  target_amount: number;
  target_token: TokenIdString;
  referral_code?: string;
}

/**
 * Request to create an EVM to Arkade swap (Token → BTC).
 */
export interface EvmToArkadeSwapRequest {
  target_address: string;
  source_amount: number;
  source_token: TokenIdString;
  user_address: string;
  referral_code?: string;
}

/**
 * Request to create an EVM to Lightning swap.
 */
export interface EvmToLightningSwapRequest {
  bolt11_invoice: string;
  source_token: TokenIdString;
  user_address: string;
  referral_code?: string;
}

/**
 * Gelato relay submit request.
 */
export interface GelatoSubmitRequest {
  create_swap_signature: string;
  user_nonce: string;
  user_deadline: string;
}

/**
 * Gelato relay submit response.
 */
export interface GelatoSubmitResponse {
  create_swap_task_id: string;
  message: string;
}

/**
 * Recovered swap with index.
 */
export type RecoveredSwap = GetSwapResponse & { index: number };

/**
 * Response from the recover swaps endpoint.
 */
export interface RecoverSwapsResponse {
  swaps: RecoveredSwap[];
  highest_index: number;
}

/**
 * Quote request parameters.
 */
export interface QuoteRequest {
  from: TokenIdString;
  to: TokenIdString;
  base_amount: number;
}

/**
 * Version information (snake_case for consistency with other API types).
 */
export interface VersionInfo {
  tag: string;
  commit_hash: string;
}

/**
 * Quote response (snake_case for consistency with other API types).
 */
export interface QuoteResponseInfo {
  exchange_rate: string;
  network_fee: number;
  protocol_fee: number;
  protocol_fee_rate: number;
  min_amount: number;
  max_amount: number;
}

/**
 * Convert a value from WASM (which may be a Map) to a plain object.
 * serde_wasm_bindgen serializes structs as Maps by default.
 */
function fromWasm<T>(value: unknown): T {
  if (value instanceof Map) {
    return Object.fromEntries(value) as T;
  }
  return value as T;
}

/**
 * Typed storage provider interface for wallet data (mnemonic, key index).
 * Provides typed async methods for wallet credential storage.
 */
export interface WalletStorageProvider {
  /** Get the mnemonic phrase. Returns null if not stored. */
  getMnemonic: () => Promise<string | null>;
  /** Store the mnemonic phrase. Overwrites any existing mnemonic. */
  setMnemonic: (mnemonic: string) => Promise<void>;
  /** Get the current key derivation index. Returns 0 if not set. */
  getKeyIndex: () => Promise<number>;
  /** Set the key derivation index. */
  setKeyIndex: (index: number) => Promise<void>;
}

/**
 * Typed storage provider interface for swap data.
 * Uses ExtendedSwapStorageData objects directly, allowing implementations
 * to store them efficiently (e.g., as objects in IndexedDB via Dexie).
 */
export interface SwapStorageProvider {
  /** Get swap data by swap ID. Returns null if not found. */
  get: (swapId: string) => Promise<ExtendedSwapStorageData | null>;
  /** Store swap data. Overwrites any existing swap with the same ID. */
  store: (swapId: string, data: ExtendedSwapStorageData) => Promise<void>;
  /** Delete swap data by swap ID. */
  delete: (swapId: string) => Promise<void>;
  /** List all stored swap IDs. */
  list: () => Promise<string[]>;
  /** List all stored swaps. */
  getAll: () => Promise<ExtendedSwapStorageData[]>;
}

/**
 * Network type for Bitcoin networks.
 */
export type Network = "bitcoin" | "testnet" | "regtest" | "mutinynet";

export class Client {
  private client: WasmClient;

  private constructor(client: WasmClient) {
    this.client = client;
  }

  /**
   * Create a new Client instance.
   *
   * @param baseUrl - The base URL of the Lendaswap API
   * @param walletStorage - Storage provider for persisting wallet data (mnemonic, key index)
   * @param swapStorage - Storage provider for persisting swap data (uses Dexie/IndexedDB)
   * @param network - Bitcoin network ("bitcoin", "testnet", "regtest", "mutinynet")
   * @param arkadeUrl - Arkade's server url
   * @param wasmPath - Optional path to the WASM file (for Node.js environments)
   * @returns A new Client instance
   *
   * @example
   * ```typescript
   * import Dexie from 'dexie';
   *
   * // Wallet storage using localStorage with typed methods
   * const walletStorage: WalletStorageProvider = {
   *   getMnemonic: async () => localStorage.getItem('mnemonic'),
   *   setMnemonic: async (mnemonic) => localStorage.setItem('mnemonic', mnemonic),
   *   getKeyIndex: async () => parseInt(localStorage.getItem('key_index') ?? '0'),
   *   setKeyIndex: async (index) => localStorage.setItem('key_index', index.toString()),
   * };
   *
   * // Swap storage using Dexie (IndexedDB)
   * const db = new Dexie('lendaswap');
   * db.version(1).stores({ swaps: 'id' });
   *
   * const swapStorage: SwapStorageProvider = {
   *   get: async (swapId) => await db.table('swaps').get(swapId) ?? null,
   *   store: async (swapId, data) => await db.table('swaps').put({ id: swapId, ...data }),
   *   delete: async (swapId) => await db.table('swaps').delete(swapId),
   *   list: async () => await db.table('swaps').toCollection().primaryKeys() as string[],
   *   getAll: async () => await db.table('swaps').toArray(),
   * };
   *
   * const client = await Client.create(
   *   'https://apilendaswap.lendasat.com',
   *   walletStorage,
   *   swapStorage,
   *   'bitcoin',
   *   'https://arkade.computer'
   * );
   * ```
   */
  static async create(
    baseUrl: string,
    walletStorage: WalletStorageProvider,
    swapStorage: SwapStorageProvider,
    network: Network,
    arkadeUrl: string,
    wasmPath?: string,
  ): Promise<Client> {
    await initWasm(wasmPath);
    // Bind wallet storage methods to preserve 'this' context when called from WASM
    const jsWalletStorageProvider = new JsWalletStorageProvider(
      walletStorage.getMnemonic.bind(walletStorage),
      walletStorage.setMnemonic.bind(walletStorage),
      walletStorage.getKeyIndex.bind(walletStorage),
      walletStorage.setKeyIndex.bind(walletStorage),
    );
    // Bind swap storage methods to preserve 'this' context when called from WASM
    const jsSwapStorageProvider = new JsSwapStorageProvider(
      swapStorage.get.bind(swapStorage),
      swapStorage.store.bind(swapStorage),
      swapStorage.delete.bind(swapStorage),
      swapStorage.list.bind(swapStorage),
      swapStorage.getAll.bind(swapStorage),
    );
    const wasmClient = new WasmClient(
      baseUrl,
      jsWalletStorageProvider,
      jsSwapStorageProvider,
      network,
      arkadeUrl,
    );

    return new Client(wasmClient);
  }

  async init(mnemonic?: string): Promise<void> {
    await this.client.init(mnemonic);
  }

  /**
   * Create an Arkade to EVM swap (BTC → Token).
   *
   * @param request - The swap request parameters
   * @param targetNetwork - Target EVM network (e.g., 'polygon', 'ethereum')
   * @returns The created swap response
   */
  async createArkadeToEvmSwap(
    request: SwapRequest,
    targetNetwork: "ethereum" | "polygon",
  ): Promise<BtcToEvmSwapResponse> {
    const response = await this.client.createArkadeToEvmSwap(
      request.target_address,
      request.target_amount,
      request.target_token,
      targetNetwork,
      request.referral_code,
    );
    // serde_wasm_bindgen returns a Map for complex structs, convert to plain object
    const obj = fromWasm<Omit<BtcToEvmSwapResponse, "direction">>(response);
    return { ...obj, direction: "btc_to_evm" };
  }

  /**
   * Create an EVM to Arkade swap (Token → BTC).
   *
   * @param request - The swap request parameters
   * @param sourceNetwork - Source EVM network (e.g., 'polygon', 'ethereum')
   * @returns The created swap response
   */
  async createEvmToArkadeSwap(
    request: EvmToArkadeSwapRequest,
    sourceNetwork: "ethereum" | "polygon",
  ): Promise<EvmToBtcSwapResponse> {
    const response = await this.client.createEvmToArkadeSwap(
      request.target_address,
      request.user_address,
      request.source_amount,
      request.source_token,
      sourceNetwork,
      request.referral_code,
    );
    // serde_wasm_bindgen returns a Map for complex structs, convert to plain object
    const obj = fromWasm<Omit<EvmToBtcSwapResponse, "direction">>(response);
    return { ...obj, direction: "evm_to_btc" };
  }

  /**
   * Create an EVM to Lightning swap (Token → BTC).
   *
   * @param request - The swap request parameters
   * @param sourceNetwork - Source EVM network (e.g., 'polygon', 'ethereum')
   * @returns The created swap response
   */
  async createEvmToLightningSwap(
    request: EvmToLightningSwapRequest,
    sourceNetwork: "ethereum" | "polygon",
  ): Promise<EvmToBtcSwapResponse> {
    const response = await this.client.createEvmToLightningSwap(
      request.bolt11_invoice,
      request.user_address,
      request.source_token,
      sourceNetwork,
      request.referral_code,
    );
    // serde_wasm_bindgen returns a Map for complex structs, convert to plain object
    const obj = fromWasm<Omit<EvmToBtcSwapResponse, "direction">>(response);
    return { ...obj, direction: "evm_to_btc" };
  }

  async getAssetPairs() {
    return (await this.client.getAssetPairs()) as AssetPair[];
  }

  /**
   * Get a quote for a swap.
   *
   * @param from - Source token ID (e.g., 'btc_arkade')
   * @param to - Destination token ID (e.g., 'usdc_pol')
   * @param baseAmount - Amount in base units (satoshis for BTC, wei for EVM)
   * @returns Quote response with exchange rate and fees
   */
  async getQuote(
    from: TokenIdString,
    to: TokenIdString,
    baseAmount: bigint,
  ): Promise<QuoteResponseInfo> {
    const quote = await this.client.getQuote(from, to, baseAmount);
    return {
      exchange_rate: quote.exchangeRate,
      network_fee: Number(quote.networkFee),
      protocol_fee: Number(quote.protocolFee),
      protocol_fee_rate: quote.protocolFeeRate,
      min_amount: Number(quote.minAmount),
      max_amount: Number(quote.maxAmount),
    };
  }

  /**
   * Get a swap by its ID.
   *
   * @param id - The swap ID
   * @returns The swap response
   */
  async getSwap(id: string): Promise<ExtendedSwapStorageData> {
    return (await this.client.getSwap(id)) as ExtendedSwapStorageData;
  }

  /**
   * Gets all stored swaps.
   *
   * @returns A vec of swaps
   */
  async listAllSwaps(): Promise<ExtendedSwapStorageData[]> {
    return (await this.client.listAll()) as ExtendedSwapStorageData[];
  }

  /**
   * Claim a swap via Gelato relay (gasless).
   *
   * @param swapId - The swap ID
   * @param secret - The preimage secret (hex-encoded)
   */
  async claimGelato(swapId: string, secret?: string): Promise<void> {
    await this.client.claimGelato(swapId, secret);
  }

  /**
   * Get the VHTLC amounts associated with a swap.
   *
   * @param swapId - The swap ID
   * @returns VhtlcAmounts
   */
  async amountsForSwap(swapId: string): Promise<VhtlcAmounts> {
    return (await this.client.amountsForSwap(swapId)) as VhtlcAmounts;
  }

  /**
   * Claim a swap VHTLC
   *
   * @param swapId - The swap ID
   */
  async claimVhtlc(swapId: string): Promise<void> {
    await this.client.claimVhtlc(swapId);
  }

  /**
   * Claim a swap VHTLC
   *
   * @param swapId - The swap ID
   * @returns The TXID of the Ark transaction which refunded the VHTLC.
   */
  async refundVhtlc(swapId: string, refundAddress: string): Promise<string> {
    return await this.client.refundVhtlc(swapId, refundAddress);
  }

  /**
   * Get the API version.
   *
   * @returns Version information
   */
  async getVersion(): Promise<VersionInfo> {
    const version = await this.client.getVersion();
    return {
      tag: version.tag,
      commit_hash: version.commitHash,
    };
  }

  /**
   * Recover swaps for the currently loaded mnemonic.
   *
   * @returns Response containing recovered swaps
   */
  async recoverSwaps(): Promise<ExtendedSwapStorageData[]> {
    return (await this.client.recoverSwaps()) as ExtendedSwapStorageData[];
  }

  /**
   * Get current loaded mnemonic
   * @returns The mnemonic as string
   */
  async getMnemonic(): Promise<string> {
    return await this.client.getMnemonic();
  }
  /**
   * Get current loaded user id xpub
   * @returns The xpub as string
   */
  async getUserIdXpub(): Promise<string> {
    return await this.client.getUserIdXpub();
  }

  /**
   * Deletes all stored swaps
   */
  async clearSwapStorage(): Promise<void> {
    return await this.client.clearSwapStorage();
  }

  /**
   * Delete one particular swap by id
   */
  async deleteSwap(id: string): Promise<void> {
    return await this.client.deleteSwap(id);
  }
}

/**
 * Log level type for SDK logging configuration.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

/**
 * Set the SDK log level.
 *
 * This configures the log level for all Rust/WASM code in the SDK.
 * The level is persisted in localStorage under key "lendaswap_log_level",
 * so it will be used on page reload.
 *
 * @param level - Log level: "trace", "debug", "info", "warn", "error"
 *
 * @example
 * ```typescript
 * import { setLogLevel } from '@lendasat/lendaswap-sdk';
 *
 * // Enable debug logging
 * setLogLevel('debug');
 *
 * // Or set via localStorage directly (for debugging in browser console)
 * localStorage.setItem('lendaswap_log_level', 'debug');
 * // Then reload the page
 * ```
 */
export function setLogLevel(level: LogLevel): void {
  wasmSetLogLevel(level);
}

/**
 * Get the current SDK log level.
 *
 * @returns Current log level
 */
export function getLogLevel(): LogLevel {
  return wasmGetLogLevel() as LogLevel;
}
