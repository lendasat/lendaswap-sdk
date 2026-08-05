---
"@satora/swap": patch
---

Track strict Arkade VHTLCs by propagating Arkade HTLC script-version metadata
into observe-mode reconstruction. This lets tracking derive claim actions for
new strict v1 Arkade HTLC swaps instead of watching the legacy v0 script.
