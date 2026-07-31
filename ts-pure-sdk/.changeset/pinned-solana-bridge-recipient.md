---
"@lendasat/lendaswap-sdk-pure": minor
---

Bare `claim(swapId)` now works for BTC→USDC-on-Solana (CCTP) swaps.
`CreateSwapOptions` gains `bridgeRecipient` (the destination USDC ATA,
base58) and `bridgeRecipientWallet` (the owning wallet, only when the ATA
still needs creation): pass them at create time and they are persisted on
the `StoredSwap`, so a later claim — e.g. a background auto-claim worker —
routes the CCTP burn correctly without the caller re-deriving the
recipient. Explicit claim options still take precedence over the pinned
values; a Solana-bound claim with no recipient from either source keeps
failing loudly instead of burning toward an unknown destination. Also pins
`dexie` to an exact version to avoid duplicate-instance errors in
monorepos.
