---
"@lendasat/lendaswap-sdk-pure": major
---

Lightning v2 (Spark provider), clean wire break.

- `createLightningToArkadeSwap` now takes exactly one of `sourceAmountSats`
  (invoice amount, fees deducted) or `targetAmountSats` (exact Arkade
  receive amount) instead of `satsReceive`, and the response uses the
  generic `source_amount`/`target_amount`/`source_token`/`target_token`
  fields (no more `boltz_*`, `lightning_expected_sats`, or `sats_receive`).
- Removed until they are rebuilt on the new provider:
  `createArkadeToLightningSwap`, `retryArkadeToLightningSwap`,
  `getArkadeToLightningQuote`, `createLightningToEvmSwapGeneric`,
  `createEvmToLightningSwapGeneric`, `collabRefundArkadeToLightningOffchain`,
  and the corresponding `createSwap` dispatcher routes.
