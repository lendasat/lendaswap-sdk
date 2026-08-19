---
"@lendasat/lendaswap-sdk-pure": patch
---

Bake the default account-abstraction config (bundler URL + Gas Manager policy)
into published builds, matching the hosted frontend. CCTP-inbound swaps and
sponsored UserOp claims now work out of the box; `withAa()` still overrides.
