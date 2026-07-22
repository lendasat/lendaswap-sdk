---
"@satora/swap": minor
---

Hint-driven auto-claim and more resilient tracking.

- **Opt-in auto-claim** via `ClientBuilder.withAutoClaim({ onActionRequired? })`. When enabled, tracking also subscribes to the server's status WebSocket (a faster trigger than the chain poll) and, once the chain confirms a swap is claimable, claims it automatically. Actions that need the user — a manual `fund`, or a refund to confirm — are surfaced through `onActionRequired` instead of being run. Off by default, since it spends on the user's behalf.
- **Track-on-create**: a swap created after `startTracking` is now folded into tracking (and auto-claimed) without a restart — every `create*` method routes through the hook.
- **Unreachable chains no longer break tracking**: a swap with a leg on an unconfigured chain (e.g. an EVM chain with no RPC) is skipped at `startTracking` instead of aborting tracking for every other swap, and `create*` throws rather than letting you fund a swap that can be neither observed nor claimed.

**Breaking:** `ContractManager` now requires a `canObserve(ref)` method. Only affects code that implements `ContractManager` directly (e.g. via `ClientBuilder.withContractManagers`); the built-in managers already provide it.

Also fixes: the WebSocket subscription cap is now enforced client-side (overflow was silently dropped by the server), `SwapTracker.track()` rolls back a partial registration on failure, and the worker no longer surfaces the no-op `wait` action as one needing attention.
