---
"@satora/swap": patch
---

EVM tracking now reads a whole chain in ONE `eth_getLogs` call instead of three per tracked HTLC. The three `HTLCErc20` lifecycle events all index `preimageHash` as topic1, so a single filter ORs the event signatures on topic0 and every tracked hash on topic1 across all HTLC addresses; the `claimAddress` guard on `SwapCreated` is enforced after decoding. A chain scan is now 2 RPC requests regardless of how many swaps are tracked (was `1 + 3 × swaps`) — with ~20 active swaps that's ~97% fewer requests against rate-limited public RPCs.

Breaking only for direct `EvmChainReader` implementors: `getHtlcEvents(htlc, preimageHash, claimAddress)` is replaced by `getHtlcEventsBatch(queries)` keyed by `htlcQueryKey`.
