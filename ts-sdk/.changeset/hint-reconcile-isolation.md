---
"@satora/swap": patch
---

Keep a hint when one of a swap's legs cannot be reconciled.

`applyHint` reconciled both legs under `Promise.all`, so one unreadable leg
rejected the whole hint and discarded it for the healthy leg too. The swap then
fell back to the at-risk poller, which re-reads the chain on a cadence measured
in minutes — a claim that should have gone out on the push instead waited for
the next sweep. Legs now settle independently and the swap is recomputed from
whatever did land, with the failing leg warned and left to the poller to heal.

The at-risk sweep already caught per leg; the hint path did not.
