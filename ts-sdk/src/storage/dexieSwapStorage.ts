/**
 * Dexie-based swap storage provider for IndexedDB.
 *
 * This module provides a typed swap storage implementation using Dexie,
 * which is a wrapper around IndexedDB that provides a simpler API.
 */

import Dexie, { type Table } from "dexie";
import type { ExtendedSwapStorageData } from "../api.js";

/**
 * Stored swap record in IndexedDB.
 * Extends ExtendedSwapStorageData with an id field for Dexie's primary key.
 */
interface SwapRecord extends ExtendedSwapStorageData {
  id: string;
}

/**
 * Dexie database for storing swap data.
 */
class LendaswapDatabase extends Dexie {
  swaps!: Table<SwapRecord, string>;

  constructor(dbName = "lendaswap") {
    super(dbName);
    this.version(1).stores({
      swaps: "id", // Primary key only, no additional indexes needed
    });
  }
}

/**
 * Dexie-based swap storage provider.
 *
 * Stores swap data as typed objects in IndexedDB using Dexie.
 * This provides better performance and querying capabilities compared
 * to storing serialized JSON strings.
 *
 * @example
 * ```typescript
 * import { DexieSwapStorageProvider } from '@lendaswap/sdk';
 *
 * const swapStorage = new DexieSwapStorageProvider();
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
export class DexieSwapStorageProvider {
  private db: LendaswapDatabase;

  /**
   * Create a new DexieSwapStorageProvider.
   *
   * @param dbName - Optional database name (default: "lendaswap")
   */
  constructor(dbName?: string) {
    this.db = new LendaswapDatabase(dbName);
  }

  /**
   * Get swap data by swap ID.
   *
   * @param swapId - The swap ID
   * @returns The swap data, or null if not found
   */
  async get(swapId: string): Promise<ExtendedSwapStorageData | null> {
    const record = await this.db.swaps.get(swapId);
    if (!record) {
      return null;
    }
    // Remove the id field before returning (it's not part of ExtendedSwapStorageData)
    const { id: _, ...data } = record;
    return data;
  }

  /**
   * Store swap data.
   *
   * @param swapId - The swap ID
   * @param data - The swap data to store
   */
  async store(swapId: string, data: ExtendedSwapStorageData): Promise<void> {
    await this.db.swaps.put({ id: swapId, ...data });
  }

  /**
   * Delete swap data by swap ID.
   *
   * @param swapId - The swap ID
   */
  async delete(swapId: string): Promise<void> {
    await this.db.swaps.delete(swapId);
  }

  /**
   * List all stored swap IDs.
   *
   * @returns Array of swap IDs
   */
  async list(): Promise<string[]> {
    return (await this.db.swaps.toCollection().primaryKeys()) as string[];
  }

  /**
   * Clear all swap data.
   */
  async clear(): Promise<void> {
    await this.db.swaps.clear();
  }

  /**
   * Get all stored swaps.
   *
   * @returns Array of all swap data with their IDs
   */
  async getAll(): Promise<SwapRecord[]> {
    return this.db.swaps.toArray();
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Create a Dexie-based swap storage provider.
 *
 * This is a convenience function for creating a DexieSwapStorageProvider.
 *
 * @param dbName - Optional database name (default: "lendaswap")
 * @returns A new DexieSwapStorageProvider instance
 *
 * @example
 * ```typescript
 * import { createDexieSwapStorage, Client } from '@lendaswap/sdk';
 *
 * const swapStorage = createDexieSwapStorage();
 * const client = await Client.create(
 *   'https://apilendaswap.lendasat.com',
 *   walletStorage,
 *   swapStorage,
 *   'bitcoin',
 *   'https://arkade.computer'
 * );
 * ```
 */
export function createDexieSwapStorage(
  dbName?: string,
): DexieSwapStorageProvider {
  return new DexieSwapStorageProvider(dbName);
}
