---
"@satora/swap": minor
---

Hint-first monitoring: near-zero background RPC traffic.

- **Server status hints now drive tracking in observe mode** (not just with auto-claim): whenever a base URL is configured, tracking opens the server's status WebSocket and a pushed transition triggers a targeted chain verify. `SwapWorker.execute` became optional — without it the worker relays hints and surfaces user actions but never runs anything.
- **EVM block-watch polling removed** (`eth_getBlockByNumber` every ~4s per chain, forever). The periodic tracker refresh is now a rate-limited safety net: an EVM chain is passively rescanned at most once per `fallbackScanIntervalMs` (default 3 minutes, configurable on `EvmContractManagerDeps`); targeted verifies are never gated. `chainNow` extrapolates block time between reads, so timelock flips (e.g. a refund unlocking) still surface promptly without polling.
- **Dead swaps are reaped, not watched forever**: a `pending` swap that stays unfunded a full grace hour past its client refund locktime now derives `none` instead of an empty action set — previously such swaps were tracked and scanned indefinitely. The grace window (`FUNDING_REAP_GRACE_MS`) keeps a deadline-straddling funding tx observable long enough to surface its refund path.
- **Settled swaps are never registered**: swaps whose stored status has the client's money fully settled (`serverredeemed`, `clientrefunded`, `clientrefunded*`, `clientredeemedandclientrefunded`, `expired`) are skipped at `startTracking`, instead of being re-scanned on every start.

Breaking for direct `EvmChainReader` implementors: the `watch` method is gone (and `EvmLogClient` no longer needs `watchBlocks`).
