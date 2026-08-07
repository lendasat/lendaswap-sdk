---
"@satora/swap": patch
---

Isolate a refresh failure to the chain that caused it.

Every EVM chain shares one manager, and `refresh` reconciled them under
`Promise.all`, so a single unreachable endpoint left the HTLCs on every other
chain unobserved. A swap would stop deriving actions — and never be recommended
a claim — because an unrelated swap's chain was down. Chains now settle
independently: one that throws keeps its previous observations and is retried on
the next reconcile.

`SwapTracker.startTracking` primes each ledger's manager the same way, with the
same consequence one level up, and is fixed likewise. Both paths warn with the
chain or ledger that failed.

This matches the periodic reconcile, which already tolerated a failing ledger;
only the startup prime did not.
