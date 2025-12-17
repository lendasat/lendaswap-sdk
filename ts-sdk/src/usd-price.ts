/**
 * USD price fetching utilities using CoinGecko API.
 *
 * Provides functions to fetch current USD prices for tokens supported by the SDK.
 *
 * @example
 * ```typescript
 * import { getUsdPrice, getUsdPrices, TokenId } from '@lendasat/lendaswap-sdk';
 *
 * // Get single token price
 * const btcPrice = await getUsdPrice('btc_lightning');
 * console.log('BTC price:', btcPrice);
 *
 * // Get multiple token prices
 * const prices = await getUsdPrices(['btc_lightning', 'usdc_pol', 'pol_pol']);
 * console.log('Prices:', prices);
 * ```
 */

import type { TokenIdString } from "./api.js";

/**
 * CoinGecko API base URL
 */
const COINGECKO_API = "https://api.coingecko.com/api/v3";

/**
 * Mapping from SDK TokenId to CoinGecko coin ID.
 * CoinGecko uses lowercase slugs as identifiers.
 */
const TOKEN_TO_COINGECKO: Record<string, string> = {
  // Bitcoin variants
  btc_lightning: "bitcoin",
  btc_arkade: "bitcoin",

  // Stablecoins on Polygon
  usdc_pol: "usd-coin",
  usdt0_pol: "tether",

  // Stablecoins on Ethereum
  usdc_eth: "usd-coin",
  usdt_eth: "tether",

  // Gold token
  xaut_eth: "tether-gold",

  // Native tokens
  pol_pol: "matic-network", // POL (formerly MATIC)
  eth_eth: "ethereum",
};

/**
 * Response from CoinGecko simple/price endpoint
 */
interface CoinGeckoSimplePriceResponse {
  [coinId: string]: {
    usd: number;
    usd_24h_change?: number;
  };
}

/**
 * USD price result for a token
 */
export interface UsdPriceResult {
  /** Token ID */
  tokenId: TokenIdString;
  /** USD price (null if not found) */
  usdPrice: number | null;
  /** 24h change percentage (optional) */
  change24h?: number;
}

/**
 * Options for price fetching
 */
export interface GetUsdPriceOptions {
  /** Include 24h price change. Default: false */
  include24hChange?: boolean;
}

/**
 * Get the CoinGecko ID for a given TokenId.
 *
 * @param tokenId - The SDK token ID
 * @returns CoinGecko coin ID or null if not supported
 */
export function getCoinGeckoId(tokenId: TokenIdString): string | null {
  return TOKEN_TO_COINGECKO[tokenId.toLowerCase()] ?? null;
}

/**
 * Fetch the current USD price for a single token.
 *
 * @param tokenId - Token ID (e.g., 'btc_lightning', 'usdc_pol', 'pol_pol')
 * @param options - Optional settings
 * @returns USD price or null if not found/error
 *
 * @example
 * ```typescript
 * const btcPrice = await getUsdPrice('btc_lightning');
 * if (btcPrice) {
 *   console.log(`BTC: $${btcPrice.toFixed(2)}`);
 * }
 * ```
 */
export async function getUsdPrice(
  tokenId: TokenIdString,
  options?: GetUsdPriceOptions,
): Promise<number | null> {
  const result = await getUsdPrices([tokenId], options);
  return result[0]?.usdPrice ?? null;
}

/**
 * Fetch current USD prices for multiple tokens in a single request.
 *
 * @param tokenIds - Array of token IDs
 * @param options - Optional settings
 * @returns Array of price results (same order as input)
 *
 * @example
 * ```typescript
 * const prices = await getUsdPrices(['btc_lightning', 'pol_pol', 'usdc_pol']);
 * for (const p of prices) {
 *   console.log(`${p.tokenId}: $${p.usdPrice?.toFixed(2) ?? 'N/A'}`);
 * }
 * ```
 */
export async function getUsdPrices(
  tokenIds: TokenIdString[],
  options?: GetUsdPriceOptions,
): Promise<UsdPriceResult[]> {
  // Map token IDs to CoinGecko IDs, filtering out unsupported tokens
  const tokenToCoinGecko = new Map<string, string>();
  for (const tokenId of tokenIds) {
    const coinGeckoId = getCoinGeckoId(tokenId);
    if (coinGeckoId) {
      tokenToCoinGecko.set(tokenId.toLowerCase(), coinGeckoId);
    }
  }

  // Get unique CoinGecko IDs
  const uniqueCoinGeckoIds = [...new Set(tokenToCoinGecko.values())];

  if (uniqueCoinGeckoIds.length === 0) {
    // No supported tokens, return null prices for all
    return tokenIds.map((tokenId) => ({
      tokenId,
      usdPrice: null,
    }));
  }

  // Build request URL
  const include24hChange = options?.include24hChange ?? false;
  const params = new URLSearchParams({
    ids: uniqueCoinGeckoIds.join(","),
    vs_currencies: "usd",
    ...(include24hChange && { include_24hr_change: "true" }),
  });

  try {
    const response = await fetch(`${COINGECKO_API}/simple/price?${params}`);

    if (!response.ok) {
      console.error(
        `CoinGecko API error: ${response.status} ${response.statusText}`,
      );
      return tokenIds.map((tokenId) => ({
        tokenId,
        usdPrice: null,
      }));
    }

    const data: CoinGeckoSimplePriceResponse = await response.json();

    // Map results back to token IDs
    return tokenIds.map((tokenId) => {
      const coinGeckoId = tokenToCoinGecko.get(tokenId.toLowerCase());
      if (!coinGeckoId) {
        return { tokenId, usdPrice: null };
      }

      const priceData = data[coinGeckoId];
      if (!priceData) {
        return { tokenId, usdPrice: null };
      }

      return {
        tokenId,
        usdPrice: priceData.usd,
        ...(include24hChange &&
          priceData.usd_24h_change !== undefined && {
            change24h: priceData.usd_24h_change,
          }),
      };
    });
  } catch (error) {
    console.error("Failed to fetch USD prices from CoinGecko:", error);
    return tokenIds.map((tokenId) => ({
      tokenId,
      usdPrice: null,
    }));
  }
}

/**
 * Get all supported token IDs that have USD price mappings.
 *
 * @returns Array of supported token IDs
 */
export function getSupportedTokensForUsdPrice(): TokenIdString[] {
  return Object.keys(TOKEN_TO_COINGECKO) as TokenIdString[];
}
