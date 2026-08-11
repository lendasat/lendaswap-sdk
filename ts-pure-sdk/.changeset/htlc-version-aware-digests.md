---
"@lendasat/lendaswap-sdk-pure": patch
---

`buildRedeemDigest` accepts an optional `htlcVersion` (the swap response's
`evm_htlc_version`, defaulting to 4) so EIP-712 redeem signatures keep
matching the HTLCErc20 deployment a swap was created on across contract
upgrades. The gasless and userop claim paths thread it automatically.
