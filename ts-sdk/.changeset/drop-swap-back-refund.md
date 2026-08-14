---
"@satora/swap": minor
---

Removed the swap-back refund mode. EVM-sourced swaps now always refund
the BTC-pegged HTLC token (tBTC/WBTC) directly to the depositor.

The delegated refund methods (`refundSwap`, `refundEvmWithSigner`,
`collabRefundEvmSwap`, `collabRefundEvmWithSigner`,
`submitCollabRefundEvm`) inherit the new signatures from
`@lendasat/lendaswap-sdk-pure` — the `mode`/`settlement` parameter is
gone.
