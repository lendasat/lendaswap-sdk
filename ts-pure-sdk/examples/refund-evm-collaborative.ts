/**
 * Collaborative refund: EVM → Arkade swap that expired.
 *
 * When an EVM-to-Arkade swap fails (e.g. the Arkade payout
 * could not be routed), the user can get their funds back immediately
 * via a collaborative refund — no timelock wait required.
 *
 * The server cosigns the refund and submits it on-chain on behalf
 * of the user (gasless).
 */

import {
  Client,
  InMemorySwapStorage,
  InMemoryWalletStorage,
} from "../src/index.js";

// #region setup
const client = await Client.builder()
  .withSignerStorage(new InMemoryWalletStorage())
  .withSwapStorage(new InMemorySwapStorage())
  .withOrgCode(process.env.ORG_CODE || "")
  .build();
// #endregion setup

// Assume an EVM-to-Arkade swap was created and funded, but expired
const swapId = "550e8400-e29b-41d4-a716-446655440000";

// #region check-status
const swap = await client.getSwap(swapId);
console.log("Status:", swap.status);
// ... "expired"
console.log("Direction:", swap.direction);
// ... "evm_to_arkade"
// #endregion check-status

// #region collab-refund
// Collaborative refund: the SDK signs an EIP-712 message and the
// server cosigns + submits the on-chain transaction. No gas needed.
//
// Settlement modes:
// - "swap-back": swap WBTC back to your original token (e.g. USDT) via DEX
// - "direct":    return the locked WBTC/tBTC directly
const result = await client.collabRefundEvmSwap(swapId, "swap-back");

console.log("Refund TX:", result.txHash);
// ... "0xabc123..."
console.log("Message:", result.message);
// ... "Collaborative refund submitted successfully"
// #endregion collab-refund
