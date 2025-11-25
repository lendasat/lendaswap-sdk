/**
 * Storage interface and utilities for the Lendaswap Client SDK.
 *
 * This module defines the Storage interface that can be implemented
 * for various backends (localStorage, IndexedDB, etc.).
 */

/**
 * Storage key constants matching the Rust SDK.
 */
export const STORAGE_KEYS = {
  /** Key for storing the mnemonic phrase. */
  MNEMONIC: "lendaswap_hd_mnemonic",
  /** Key for storing the current HD derivation index. */
  KEY_INDEX: "lendaswap_hd_index",
} as const;

// Swap storage (typed storage for swap data using Dexie/IndexedDB)
export {
  createDexieSwapStorage,
  DexieSwapStorageProvider,
} from "./dexieSwapStorage.js";
// Wallet storage (typed storage for wallet data using Dexie/IndexedDB)
export {
  createDexieWalletStorage,
  DexieWalletStorageProvider,
} from "./dexieWalletStorage.js";
