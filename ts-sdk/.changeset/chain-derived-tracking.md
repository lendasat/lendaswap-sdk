---
"@satora/swap": minor
---

Chain-derived swap tracking.

- `WaitAction` gains `waitingOn`
  (`"client_payment" | "client_funding_confirmation" | "server_funding" | "claim_confirmation" | "refund_timelock"`)
  and terminal `NoneAction` gains `outcome`
  (`"completed" | "refunded" | "expired"`). Tracker emissions also carry
  `observations` — the raw chain facts the actions were derived from.
- Tracking is now push-driven via the server's status WebSocket (observe mode
  included), with each pushed transition verified on-chain; background polling
  is gone. While client funds are locked on-chain, an independent watcher
  re-verifies both legs every 60s, so refund availability never depends on the
  server.
- Bitcoin funding is treated as confirmed at 0-conf by default, so
  evm→bitcoin swaps claim immediately.
  `ClientBuilder.withBitcoinMinConfirmations(n)` restores block-depth
  policies.
- `startTracking()` is safe to call concurrently; settled swaps persist their
  final status so later sessions skip them; a swap that stays unfunded past
  its refund locktime derives a terminal `expired`.
