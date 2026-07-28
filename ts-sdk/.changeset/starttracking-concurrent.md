---
"@satora/swap": patch
---

`startTracking()` is now safe to call concurrently: a second caller awaits the in-flight start instead of returning early on a boolean flag — which could report "started" while the tracker was still being built, crashing a subsequent `subscribeToActions()` with "call startTracking() before subscribeToActions()". A failed start still resets so a later call retries cleanly.
