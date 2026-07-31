---
"@satora/swap": minor
---

Hint-driven monitoring with a trustless refund watch. The happy path now
rides server status hints exclusively (each hint still verified on-chain
before acting); the standing EVM wss log subscriptions, Arkade script
subscriptions, and periodic passive chain scans are removed. Chain reads
happen only on: initial seeding (start / newly tracked swap), server hints,
and a gated at-risk reconcile — swaps whose client leg holds funds on-chain
(or Lightning pay-ins with no on-chain client leg) get their legs re-read
every `atRiskReconcileIntervalMs` (default 60s), so refund availability
never depends on the server. Idle swaps cost zero chain requests. The
tracker's 5s tick is now purely local (extrapolated clocks; Bitcoin MTP now
extrapolates like Arkade/EVM). Removed exports: `createEvmLogSubscriber`,
`DEFAULT_EVM_WSS`, `EvmLogSubscriber` (+ related types) and the managers'
`fallbackScanIntervalMs`/`subscribers` options.
