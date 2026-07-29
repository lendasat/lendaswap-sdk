---
"@satora/swap": minor
---

EVM tracking checks the contract, not the history: the routine "is this swap still open?" check is now `HTLCErc20.isActive` — a cheap `eth_call`, batched through Multicall3 into one request per chain (with per-HTLC fallback on chains without Multicall3, e.g. dev nodes). Because `isActive` hashes the full swap tuple (amount, token, sender, claimAddress, timelock), a `true` with the expected values also proves the HTLC was funded on exactly the expected terms.

Log scans are demoted to a classifier — only run when an HTLC reads inactive and the cause (never funded / claimed / refunded) matters, and now lower-bounded by an estimate of the swap's creation block (from `created_at` and the chain's block time) instead of scanning from genesis, so providers never see an unbounded log query. A leg already latched on a spend is never re-scanned at all.

`HtlcRef.evm` gains optional `sender`, `timelockSec`, and `createdAtMs` (populated from the swap responses). `evm_to_arkade` and `evm_to_lightning` don't expose the locked token, so on mainnet it falls back to the per-chain constant (WBTC on Polygon, tBTC on Ethereum/Arbitrum — temporary until the server returns it); off mainnet those legs keep the lenient log path. Breaking for direct `EvmChainReader` implementors: `isActiveBatch` and `getLatestBlock` (replacing `getBlockTimeMs`) are required, and `getHtlcEventsBatch` takes an optional `fromBlock`.
