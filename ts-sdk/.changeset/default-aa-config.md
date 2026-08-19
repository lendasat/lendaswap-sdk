---
"@satora/swap": patch
---

Pick up the pure SDK's baked-in default account-abstraction config (bundler
URL + Gas Manager policy): CCTP-inbound swaps and sponsored UserOp claims work
out of the box; `withAa()` still overrides.
