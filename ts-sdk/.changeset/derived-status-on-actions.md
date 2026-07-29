---
"@satora/swap": patch
---

`SwapActions` emitted by the tracker now carries `observations` — the raw chain observations (which leg is funded/spent) the actions were derived from. Chain facts, not protocol states: lets a UI render swap progress from chain truth even when the server's stored status is stale or the server is unreachable, without interpreting the `SwapStatus` enum. Absent on bare `deriveSwapActions` calls.
