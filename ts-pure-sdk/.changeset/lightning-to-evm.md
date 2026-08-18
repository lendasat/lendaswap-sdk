---
"@lendasat/lendaswap-sdk-pure": minor
---

Lightning → EVM swaps: `createLightningToEvmSwap` (and `createSwap` with a
Lightning source + EVM target) pays a hold invoice and receives any
1inch-reachable ERC-20, with gasless claims and CCTP/USDT0 bridge
destinations supported. Claims reuse the existing EVM-targeted flow; there
is no client refund action — an unclaimed hold payment unwinds on its own.
