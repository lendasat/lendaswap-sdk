---
"@satora/swap": major
"@satora/escrow-client": major
---

Lightning v2 (Spark provider), clean wire break.

- `@satora/swap`: Lightning→Arkade tracking now reads the generic
  `target_amount` field; wrappers for the removed Arkade→Lightning and
  Lightning↔EVM directions are gone until those flows are rebuilt on the
  new provider.
- `@satora/escrow-client`: `fundFromLightning` uses `targetAmountSats`;
  `withdrawToLightning` / `quoteLightningWithdrawal` keep their signatures
  but throw `LightningWithdrawalUnavailableError` while Arkade→Lightning
  swaps are rebuilt.
