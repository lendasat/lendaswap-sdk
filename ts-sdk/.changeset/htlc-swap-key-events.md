---
"@satora/swap": minor
---

Read the `key` field on `HTLCErc20` lifecycle events. The event signatures
change, so this release reads a `VERSION 4` contract and earlier releases do
not — ship it together with the contract it reads.
