---
"@satora/swap": patch
---

Registration no longer scans the chain per swap. `register()` on the EVM and
Arkade managers is now passive (store the ref + wire the push filter); the
tracker's follow-up `refresh()` observes the whole registration burst in one
batched scan per chain. Previously first load ran a full chain reconcile for
EVERY tracked swap (N× getBlock + isActive multicall + eth_getLogs against
rate-limited public RPCs). The passive-scan gate now lets never-observed refs
through, so a swap tracked mid-interval is still caught up on the next tick.
