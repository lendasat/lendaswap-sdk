---
"@satora/swap": minor
---

Arkade→Lightning swaps, rebuilt on the Spark provider.

- `createArkadeToLightningSwap` is delegated to the underlying client
  (see `@lendasat/lendaswap-sdk-pure` for the API shape) and created
  swaps are tracked: the client-funded Arkade VHTLC leg is watched; the
  Lightning payout has no on-chain leg.
- `refundSwap()` handles the direction via the shared Arkade VHTLC
  collaborative-refund flow.
