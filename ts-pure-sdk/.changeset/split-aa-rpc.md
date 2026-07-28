---
"@lendasat/lendaswap-sdk-pure": minor
---

Add SDK support for continuing refunded EVM-source swaps. New APIs expose continuation eligibility, detect refunded balances in the Kernel account, create a replacement EVM-to-Arkade, EVM-to-Bitcoin, or EVM-to-Lightning swap, and submit the replacement funding UserOp from the recovered balance.

Add a balance-funding CCTP inbound UserOp path for swaps whose funds are already in the Kernel account. This skips `receiveMessage` and submits the `approve(Permit2) + executeAndCreateWithPermit2` batch.

Support split account-abstraction endpoints. `AaConfig` now accepts an optional `rpcUrl` for normal chain reads while `bundlerUrl` is used for UserOps, and `paymasterPolicyId` is optional so callers can send self-funded UserOps when no paymaster is configured.
