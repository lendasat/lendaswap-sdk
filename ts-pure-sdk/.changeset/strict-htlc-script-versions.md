---
"@lendasat/lendaswap-sdk-pure": patch
---

Add strict HTLC script version support for BTC and Arkade swap flows. New
swap creation requests send the required v1 script-version fields, generated
API types expose the required request/response metadata, and BTC/Arkade claim
and refund reconstruction, including Arkade→EVM collaborative refunds, uses
the stored script version so strict 32-byte preimage HTLCs can be spent
correctly.
