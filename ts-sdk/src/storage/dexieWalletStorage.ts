/**
 * Dexie-based wallet storage provider for IndexedDB.
 *
 * This module provides a typed wallet storage implementation using Dexie,
 * which is a wrapper around IndexedDB that provides a simpler API.
 */

import Dexie, { type Table } from "dexie";
import type { WalletStorageProvider } from "../api.js";

/**
 * Wallet data record stored in IndexedDB.
 */
interface WalletRecord {
  /** Fixed key for the single wallet record */
  id: "wallet";
  /** The mnemonic phrase */
  mnemonic: string | null;
  /** The current key derivation index */
  keyIndex: number;
}

/**
 * Dexie database for storing wallet data.
 */
class WalletDatabase extends Dexie {
  wallet!: Table<WalletRecord, string>;

  constructor(dbName = "lendaswap-wallet") {
    super(dbName);
    this.version(1).stores({
      wallet: "id", // Primary key only
    });
  }
}

/**
 * Dexie-based wallet storage provider.
 *
 * Stores wallet data (mnemonic and key index) in IndexedDB using Dexie.
 * This provides better security than localStorage since IndexedDB data
 * is not accessible via JavaScript in the same way, and provides
 * structured storage.
 *
 * @example
 * ```typescript
 * import { DexieWalletStorageProvider, Client } from '@lendasat/lendaswap-sdk';
 *
 * const walletStorage = new DexieWalletStorageProvider();
 *
 * // Use with the Client
 * const client = await Client.create(
 *   'https://apilendaswap.lendasat.com',
 *   walletStorage,
 *   swapStorage,
 *   'bitcoin',
 *   'https://arkade.computer'
 * );
 * ```
 */
export class DexieWalletStorageProvider implements WalletStorageProvider {
  private db: WalletDatabase;
  private static readonly WALLET_ID = "wallet" as const;

  /**
   * Create a new DexieWalletStorageProvider.
   *
   * @param dbName - Optional database name (default: "lendaswap-wallet")
   */
  constructor(dbName?: string) {
    this.db = new WalletDatabase(dbName);
  }

  /**
   * Get the mnemonic phrase from storage.
   *
   * @returns The mnemonic phrase, or null if not stored
   */
  async getMnemonic(): Promise<string | null> {
    const record = await this.db.wallet.get(
      DexieWalletStorageProvider.WALLET_ID,
    );
    return record?.mnemonic ?? null;
  }

  /**
   * Store the mnemonic phrase.
   *
   * @param mnemonic - The mnemonic phrase to store
   */
  async setMnemonic(mnemonic: string): Promise<void> {
    const existing = await this.db.wallet.get(
      DexieWalletStorageProvider.WALLET_ID,
    );
    await this.db.wallet.put({
      id: DexieWalletStorageProvider.WALLET_ID,
      mnemonic,
      keyIndex: existing?.keyIndex ?? 0,
    });
  }

  /**
   * Get the current key derivation index.
   *
   * @returns The key index, or 0 if not set
   */
  async getKeyIndex(): Promise<number> {
    const record = await this.db.wallet.get(
      DexieWalletStorageProvider.WALLET_ID,
    );
    return record?.keyIndex ?? 0;
  }

  /**
   * Set the key derivation index.
   *
   * @param index - The key index to store
   */
  async setKeyIndex(index: number): Promise<void> {
    const existing = await this.db.wallet.get(
      DexieWalletStorageProvider.WALLET_ID,
    );
    await this.db.wallet.put({
      id: DexieWalletStorageProvider.WALLET_ID,
      mnemonic: existing?.mnemonic ?? null,
      keyIndex: index,
    });
  }

  /**
   * Clear all wallet data.
   */
  async clear(): Promise<void> {
    await this.db.wallet.clear();
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Create a Dexie-based wallet storage provider.
 *
 * This is a convenience function for creating a DexieWalletStorageProvider.
 *
 * @param dbName - Optional database name (default: "lendaswap-wallet")
 * @returns A new DexieWalletStorageProvider instance
 *
 * @example
 * ```typescript
 * import { createDexieWalletStorage, createDexieSwapStorage, Client } from '@lendasat/lendaswap-sdk';
 *
 * const walletStorage = createDexieWalletStorage();
 * const swapStorage = createDexieSwapStorage();
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
export function createDexieWalletStorage(
  dbName?: string,
): DexieWalletStorageProvider {
  return new DexieWalletStorageProvider(dbName);
}
