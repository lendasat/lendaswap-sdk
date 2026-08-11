import { hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { StrictVhtlcScript } from "../src/strict-vhtlc.js";
import vectors from "./fixtures/strict-vhtlc-vectors.js";

const vector = vectors.strictArkadeVhtlcV1;

function bytes(value: string): Uint8Array {
  return hex.decode(value);
}

describe("StrictVhtlcScript", () => {
  it("matches the strict Arkade VHTLC cross-language vector", () => {
    const script = new StrictVhtlcScript({
      sender: bytes(vector.sender),
      receiver: bytes(vector.receiver),
      server: bytes(vector.server),
      preimageHash: bytes(vector.preimageHash),
      refundLocktime: BigInt(vector.refundLocktime),
      unilateralClaimDelay: {
        type: "blocks",
        value: BigInt(vector.unilateralClaimDelay),
      },
      unilateralRefundDelay: {
        type: "blocks",
        value: BigInt(vector.unilateralRefundDelay),
      },
      unilateralRefundWithoutReceiverDelay: {
        type: "blocks",
        value: BigInt(vector.unilateralRefundWithoutReceiverDelay),
      },
    });

    expect(script.claimScript).toBe(vector.scripts.claim);
    expect(script.refundScript).toBe(vector.scripts.refund);
    expect(script.refundWithoutReceiverScript).toBe(
      vector.scripts.refundWithoutReceiver,
    );
    expect(script.unilateralClaimScript).toBe(vector.scripts.unilateralClaim);
    expect(script.unilateralRefundScript).toBe(vector.scripts.unilateralRefund);
    expect(script.unilateralRefundWithoutReceiverScript).toBe(
      vector.scripts.unilateralRefundWithoutReceiver,
    );
    expect(hex.encode(script.pkScript)).toBe(vector.scriptPubKey);
    expect(
      script.address(vector.arkadeHrp, bytes(vector.server)).encode(),
    ).toBe(vector.address);
  });
});
