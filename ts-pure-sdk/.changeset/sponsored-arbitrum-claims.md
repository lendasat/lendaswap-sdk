---
"@lendasat/lendaswap-sdk-pure": minor
---

Publish every Arbitrum EVM-target claim as a paymaster-sponsored UserOp when
AA config is present (`.withAa(...)`), not only DEX/CCTP claims. Plain
(no-DEX) claims fall back to the server-submitted `/claim-gasless` path if
the UserOp publish fails or no AA config is set; DEX/CCTP claims still
require AA config.
