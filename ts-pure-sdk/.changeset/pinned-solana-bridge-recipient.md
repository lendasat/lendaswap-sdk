---
"@lendasat/lendaswap-sdk-pure": minor
---

`CreateSwapOptions` gains `bridgeRecipient` (the destination USDC ATA) and
`bridgeRecipientWallet` (the owning wallet, only when the ATA still needs
creation). Both are persisted on the `StoredSwap`, so a bare `claim(swapId)`
now works for BTC→USDC-on-Solana (CCTP) swaps; explicit claim options still
take precedence. Also pins `dexie` to an exact version to avoid
duplicate-instance errors in monorepos.
