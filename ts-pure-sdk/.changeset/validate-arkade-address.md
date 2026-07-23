---
"@lendasat/lendaswap-sdk-pure": patch
---

Validate Arkade addresses before creating swaps. `createBitcoinToArkadeSwap`, `createLightningToArkadeSwap`, and `createEvmToArkadeSwapGeneric` now throw early on a malformed target address instead of sending it to the server. Adds `validateArkadeAddress` and `isValidArkadeAddress` helpers (full bech32m decode, optional network check).
