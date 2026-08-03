---
"@satora/swap": minor
---

Chain-derived swap tracking: richer actions, hint-driven monitoring, and a
trustless refund watch.

- **Typed action semantics.** `WaitAction` gains `waitingOn`
  (`"client_payment" | "client_funding_confirmation" | "server_funding" | "claim_confirmation" | "refund_timelock"`) and terminal `NoneAction` gains
  `outcome` (`"completed" | "refunded" | "expired"`), so a consumer can pick
  the right surface by switching on typed fields. Tracker emissions also
  carry `observations` — the raw chain facts (is each HTLC leg funded/spent)
  the actions were derived from — letting a UI render swap progress from
  chain truth even when the server is stale or unreachable, without
  interpreting the `SwapStatus` enum.
- **Hint-driven monitoring.** Tracking now runs on the server's status
  WebSocket whenever a base URL is configured (observe mode included — no
  auto-claim needed): a pushed transition triggers a targeted on-chain
  verification, and the chain stays the source of truth. Background polling
  is gone; while a swap has client funds locked on-chain, an at-risk watcher
  independently re-verifies both legs every 60s, so knowing when a refund
  unlocks never depends on the server being reachable or honest. Idle,
  unfunded, and settled swaps cost zero chain requests, and chain clocks
  extrapolate between reads so timelock flips surface promptly.
- **Cheap EVM observation.** The routine "is this swap still open?" check is
  `HTLCErc20.isActive` — one Multicall3-batched `eth_call` per chain whose
  `true` also proves the HTLC was funded on exactly the expected terms (the
  key hashes amount/token/addresses/timelock). Anything it can't prove is
  classified from a single batched `eth_getLogs` per chain, lower-bounded
  near the swaps' creation blocks.
- **Bitcoin 0-conf by default.** A Bitcoin funding tx observes as `confirmed`
  as soon as it hits the mempool, so an evm→bitcoin swap claims immediately
  instead of waiting ~10min for a block. This trusts the funder not to
  double-spend the funding after the claim publishes the preimage.
  `ClientBuilder.withBitcoinMinConfirmations(n)` restores block-depth policies
  for callers who don't want that assumption.
- **Lifecycle fixes.** `startTracking()` is safe to call concurrently
  (single-flight); swaps that settle while the app is closed persist their
  final status to storage so later sessions skip them; a `pending` swap that
  stays unfunded past its refund locktime (plus a grace hour) derives a
  terminal `expired` instead of being watched forever.
