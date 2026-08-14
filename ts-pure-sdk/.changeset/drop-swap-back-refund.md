---
"@lendasat/lendaswap-sdk-pure": major
---

Removed the swap-back refund mode. EVM-sourced swaps now always refund
the BTC-pegged HTLC token (tBTC/WBTC) directly to the depositor; the
DEX swap back to the original source token is gone.

Breaking API changes:

- `refundSwap()`'s `EvmRefundOptions` no longer has `mode`.
- `refundEvmWithSigner`, `collabRefundEvmSwap`,
  `collabRefundEvmWithSigner`, `getCollabRefundEvmParams`, and
  `buildCollabRefundEvmTypedData` lost their `mode`/`settlement`
  parameter.
- `submitCollabRefundEvm`'s body no longer takes `mode`, `sweep_token`,
  or `min_amount_out` — the server hardcodes `sweepToken` = tBTC/WBTC
  and `minAmountOut` = 0.
- `CollabRefundEvmParams` lost `mode`, `sourceTokenAddress`, and
  `dexCalldata`; the unused `CoordinatorRefundCallData` type was
  removed.

Old 1.x clients keep working against the new server: the removed fields
are ignored and refunds degrade to direct settlement.
