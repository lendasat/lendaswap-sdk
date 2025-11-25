/**
 * Type definitions for the Lendaswap Client SDK.
 */

/**
 * Bitcoin network type.
 */
export type Network = "bitcoin" | "testnet" | "regtest" | "mutinynet";

/**
 * Parameters derived for a swap operation.
 */
export interface SwapParams {
  /** Secret key (hex-encoded). */
  ownSk: string;
  /** Public key (hex-encoded). */
  ownPk: string;
  /** Preimage for HTLC (hex-encoded). */
  preimage: string;
  /** Hash of the preimage (hex-encoded). */
  preimageHash: string;
  /** User ID derived from HD wallet (hex-encoded). */
  userId: string;
  /** Key derivation index used. */
  keyIndex: number;
}

/**
 * VHTLC amounts returned from Arkade.
 */
export interface VhtlcAmounts {
  /** Amount that can be spent (in satoshis). */
  spendable: number;
  /** Amount already spent (in satoshis). */
  spent: number;
  /** Amount that can be recovered via refund (in satoshis). */
  recoverable: number;
}

/**
 * Swap data stored locally for VHTLC operations.
 */
export interface SwapData {
  /** HD derivation index for this swap. */
  keyIndex: number;
  /** Public key of Lendaswap service. */
  lendaswapPk: string;
  /** Arkade server public key. */
  arkadeServerPk: string;
  /** Absolute locktime for refunds. */
  refundLocktime: number;
  /** Relative delay for unilateral claim. */
  unilateralClaimDelay: number;
  /** Relative delay for unilateral refund. */
  unilateralRefundDelay: number;
  /** Relative delay for unilateral refund without receiver. */
  unilateralRefundWithoutReceiverDelay: number;
  /** Bitcoin network. */
  network: string;
  /** VHTLC address on Arkade. */
  vhtlcAddress: string;
}
