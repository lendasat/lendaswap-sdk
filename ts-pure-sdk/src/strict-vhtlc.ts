import {
  CLTVMultisigTapscript,
  ConditionCSVMultisigTapscript,
  ConditionMultisigTapscript,
  CSVMultisigTapscript,
  MultisigTapscript,
  type RelativeTimelock,
  type TapLeafScript,
  VtxoScript,
} from "@arkade-os/sdk";
import { hex } from "@scure/base";
import { Script as BtcScript } from "@scure/btc-signer";

export const ARKADE_HTLC_SCRIPT_VERSION_LEGACY = 0;
export const ARKADE_HTLC_SCRIPT_VERSION_STRICT = 1;

export interface StrictVhtlcOptions {
  sender: Uint8Array;
  receiver: Uint8Array;
  server: Uint8Array;
  preimageHash: Uint8Array;
  refundLocktime: bigint;
  unilateralClaimDelay: RelativeTimelock;
  unilateralRefundDelay: RelativeTimelock;
  unilateralRefundWithoutReceiverDelay: RelativeTimelock;
}

export class StrictVhtlcScript extends VtxoScript {
  readonly claimScript: string;
  readonly refundScript: string;
  readonly refundWithoutReceiverScript: string;
  readonly unilateralClaimScript: string;
  readonly unilateralRefundScript: string;
  readonly unilateralRefundWithoutReceiverScript: string;

  constructor(readonly options: StrictVhtlcOptions) {
    validateOptions(options);

    const conditionScript = preimageConditionScript(options.preimageHash);

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

    this.claimScript = hex.encode(claimScript);
    this.refundScript = hex.encode(refundScript);
    this.refundWithoutReceiverScript = hex.encode(refundWithoutReceiverScript);
    this.unilateralClaimScript = hex.encode(unilateralClaimScript);
    this.unilateralRefundScript = hex.encode(unilateralRefundScript);
    this.unilateralRefundWithoutReceiverScript = hex.encode(
      unilateralRefundWithoutReceiverScript,
    );
  }

  claim(): TapLeafScript {
    return this.findLeaf(this.claimScript);
  }

  refund(): TapLeafScript {
    return this.findLeaf(this.refundScript);
  }

  refundWithoutReceiver(): TapLeafScript {
    return this.findLeaf(this.refundWithoutReceiverScript);
  }

  unilateralClaim(): TapLeafScript {
    return this.findLeaf(this.unilateralClaimScript);
  }

  unilateralRefund(): TapLeafScript {
    return this.findLeaf(this.unilateralRefundScript);
  }

  unilateralRefundWithoutReceiver(): TapLeafScript {
    return this.findLeaf(this.unilateralRefundWithoutReceiverScript);
  }
}

function validateOptions(options: StrictVhtlcOptions): void {
  if (options.preimageHash.length !== 20)
    throw new Error("preimage hash must be 20 bytes");
  if (options.sender.length !== 32)
    throw new Error("Invalid public key length (sender)");
  if (options.receiver.length !== 32)
    throw new Error("Invalid public key length (receiver)");
  if (options.server.length !== 32)
    throw new Error("Invalid public key length (server)");
  if (options.refundLocktime <= 0n)
    throw new Error("refund locktime must be greater than 0");
}

function preimageConditionScript(preimageHash: Uint8Array): Uint8Array {
  return BtcScript.encode([
    "SIZE",
    32,
    "EQUALVERIFY",
    "HASH160",
    preimageHash,
    "EQUAL",
  ]);
}
