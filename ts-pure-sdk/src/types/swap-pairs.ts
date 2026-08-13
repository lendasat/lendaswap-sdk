/**
 * `SwapPairsResponse` — supported swap routes with limits and base
 * protocol fee per pair.
 *
 * Hand-written; identity-shaped with the OpenAPI codegen today.
 */
import type { Chain } from "./chain.js";

export interface SwapPairInfo {
  source: Chain;
  target: Chain;
  /** Minimum BTC amount in satoshis. */
  min_sats: number;
  /** Maximum BTC amount in satoshis. */
  max_sats: number;
  /**
   * Fee percentage as a decimal (e.g. 0.0025 = 0.25%).
   */
  fee_percentage: number;
  /**
   * Flat network fee in satoshis charged on every swap of this pair on
   * top of `fee_percentage` (`0` for pairs that do not charge one).
   */
  network_fee_sats: number;
}

export interface SwapPairsResponse {
  pairs: SwapPairInfo[];
}

export interface WireSwapPairInfo {
  source: Chain;
  target: Chain;
  min_sats: number;
  max_sats: number;
  fee_percentage: number;
  network_fee_sats: number;
}

export interface WireSwapPairsResponse {
  pairs: WireSwapPairInfo[];
}

export function fromWireSwapPairInfo(wire: WireSwapPairInfo): SwapPairInfo {
  return {
    source: wire.source,
    target: wire.target,
    min_sats: wire.min_sats,
    max_sats: wire.max_sats,
    fee_percentage: wire.fee_percentage,
    network_fee_sats: wire.network_fee_sats,
  };
}

export function fromWireSwapPairsResponse(
  wire: WireSwapPairsResponse,
): SwapPairsResponse {
  return { pairs: wire.pairs.map(fromWireSwapPairInfo) };
}
