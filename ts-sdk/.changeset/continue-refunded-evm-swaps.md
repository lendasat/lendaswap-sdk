---
"@satora/swap": minor
---

Expose refunded EVM-source swap continuation APIs through the migrated swap SDK. `getRefundedEvmSwapContinuation` reports whether a refunded EVM-source swap has recoverable Kernel-account balance, and `continueRefundedEvmSwap` creates and funds a replacement swap from that balance.
