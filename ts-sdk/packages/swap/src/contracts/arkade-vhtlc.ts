/**
 * Build the Arkade {@link HtlcRef} for a swap's VHTLC leg from the plain swap
 * fields, deriving the pkScript and serialized contract params the
 * `ArkadeContractManager` needs to register it for watching.
 *
 * This is the one place that reconstructs the VHTLC from a swap, mirroring the
 * legacy SDK's `VHTLC.Script` construction, so the mapper and manager stay free
 * of VHTLC internals.
 */

import { VHTLC, VHTLCContractHandler } from "@arkade-os/sdk";
import {
  CLTVMultisigTapscript,
  ConditionCSVMultisigTapscript,
  ConditionMultisigTapscript,
  CSVMultisigTapscript,
  MultisigTapscript,
  VHTLC,
  VHTLCContractHandler,
  VtxoScript,
  type RelativeTimelock,
} from "@arkade-os/sdk";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { hex } from "@scure/base";
import type { HtlcRef } from "./types.js";

type ArkadeRef = Extract<HtlcRef, { ledger: "arkade" }>;

export const ARKADE_HTLC_SCRIPT_VERSION_LEGACY = 0;
export const ARKADE_HTLC_SCRIPT_VERSION_STRICT = 1;

export type ArkadeVhtlcInput = {
  /** Pubkey hex (x-only or compressed) for each VHTLC role. */
  senderPk: string;
  receiverPk: string;
  serverPk: string;
  /**
   * The swap's `hash_lock`, hex, `0x`-prefixed or not. Either `sha256(preimage)`
   * (32 bytes — most directions) or the `ripemd160(sha256(preimage))` HASH160 the
   * VHTLC commits to directly (20 bytes — `btc_to_arkade`). Length disambiguates.
   */
  hashLock: string;
  /** The VHTLC address the server reported. */
  address: string;
  /** Absolute CLTV refund locktime (unix seconds). */
  refundLocktime: number;
  /** Relative unilateral delays (seconds). */
  unilateralClaimDelay: number;
  unilateralRefundDelay: number;
  unilateralRefundWithoutReceiverDelay: number;
  /** Expected funding amount in sats (a short funding is `invalid`, not confirmed). */
  expectedSats: number;
  /** Arkade HTLC script version. Missing means legacy v0 for old stored swaps. */
  arkadeHtlcScriptVersion?: number;
};

function strip0x(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

/** Normalize a pubkey hex to the 32-byte x-only form the VHTLC expects. */
function xOnly(pubKeyHex: string): Uint8Array {
  const bytes = hex.decode(strip0x(pubKeyHex));
  if (bytes.length === 33) return bytes.slice(1);
  if (bytes.length === 32) return bytes;
  throw new Error(`invalid public key length: ${bytes.length}`);
}

const seconds = (value: number) =>
  ({ type: "seconds", value: BigInt(value) }) as const;

function strictConditionScript(preimageHash: Uint8Array): Uint8Array {
  if (preimageHash.length !== 20)
    throw new Error("preimage hash must be 20 bytes");
  return new Uint8Array([
    0x82, // OP_SIZE
    0x01, // push one byte
    0x20, // 32
    0x88, // OP_EQUALVERIFY
    0xa9, // OP_HASH160
    0x14, // push 20 bytes
    ...preimageHash,
    0x87, // OP_EQUAL
  ]);
}

type StrictVhtlcParams = {
  sender: Uint8Array;
  receiver: Uint8Array;
  server: Uint8Array;
  preimageHash: Uint8Array;
  refundLocktime: bigint;
  unilateralClaimDelay: RelativeTimelock;
  unilateralRefundDelay: RelativeTimelock;
  unilateralRefundWithoutReceiverDelay: RelativeTimelock;
};

class StrictVhtlcScript extends VtxoScript {
  constructor(options: StrictVhtlcParams) {
    const conditionScript = strictConditionScript(options.preimageHash);
    const claimScript = ConditionMultisigTapscript.encode({
      conditionScript,
      pubkeys: [options.receiver, options.server],
    }).script;
    const refundScript = MultisigTapscript.encode({
      pubkeys: [options.sender, options.receiver, options.server],
    }).script;
    const refundWithoutReceiverScript = CLTVMultisigTapscript.encode({
      absoluteTimelock: options.refundLocktime,
      pubkeys: [options.sender, options.server],
    }).script;
    const unilateralClaimScript = ConditionCSVMultisigTapscript.encode({
      conditionScript,
      timelock: options.unilateralClaimDelay,
      pubkeys: [options.receiver],
    }).script;
    const unilateralRefundScript = CSVMultisigTapscript.encode({
      timelock: options.unilateralRefundDelay,
      pubkeys: [options.sender, options.receiver],
    }).script;
    const unilateralRefundWithoutReceiverScript = CSVMultisigTapscript.encode({
      timelock: options.unilateralRefundWithoutReceiverDelay,
      pubkeys: [options.sender],
    }).script;

    super([
      claimScript,
      refundScript,
      refundWithoutReceiverScript,
      unilateralClaimScript,
      unilateralRefundScript,
      unilateralRefundWithoutReceiverScript,
    ]);
  }
}

/**
 * The VHTLC always commits to `ripemd160(sha256(preimage))` (HASH160). When
 * `hashLock` is `sha256(preimage)` (32 bytes) we hash it once more to get that;
 * when it is already the HASH160 (20 bytes, `btc_to_arkade`) we use it as-is. The
 * ref keeps `preimageHash` as the raw `hashLock` — whatever length — and the spend
 * classifier verifies a revealed preimage against it, auto-detecting the algorithm
 * from that length.
 */
export function buildArkadeVhtlcRef(input: ArkadeVhtlcInput): ArkadeRef {
  const hashLockBytes = hex.decode(strip0x(input.hashLock));
  const params = {
    sender: xOnly(input.senderPk),
    receiver: xOnly(input.receiverPk),
    server: xOnly(input.serverPk),
    preimageHash:
      hashLockBytes.length === 20 ? hashLockBytes : ripemd160(hashLockBytes),
    refundLocktime: BigInt(input.refundLocktime),
    unilateralClaimDelay: seconds(input.unilateralClaimDelay),
    unilateralRefundDelay: seconds(input.unilateralRefundDelay),
    unilateralRefundWithoutReceiverDelay: seconds(
      input.unilateralRefundWithoutReceiverDelay,
    ),
  };
  const vhtlc = (() => {
    switch (
      input.arkadeHtlcScriptVersion ??
      ARKADE_HTLC_SCRIPT_VERSION_LEGACY
    ) {
      case ARKADE_HTLC_SCRIPT_VERSION_LEGACY:
        return new VHTLC.Script(params);
      case ARKADE_HTLC_SCRIPT_VERSION_STRICT:
        return new StrictVhtlcScript(params);
      default:
        throw new Error(
          `Unsupported Arkade HTLC script version: ${input.arkadeHtlcScriptVersion}`,
        );
    }
  })();
  return {
    ledger: "arkade",
    script: hex.encode(vhtlc.pkScript),
    address: input.address,
    preimageHash: strip0x(input.hashLock),
    expectedSats: input.expectedSats,
    params: VHTLCContractHandler.serializeParams(params),
  };
}
