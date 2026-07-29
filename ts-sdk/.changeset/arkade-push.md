---
"@satora/swap": patch
---

Arkade tracking is push-driven: the manager subscribes to its VHTLC pkScripts via the Ark indexer's script subscription (`subscribeForScripts` / `getSubscription` stream) and reconciles a leg the moment an event lands, instead of polling `getVtxos` on every tracker tick. While the stream is live, the periodic refresh is rate-limited to the same 3-minute safety net as the EVM manager (targeted verifies never gated); a dropped stream re-subscribes with backoff and runs a catch-up scan. The MTP clock is extrapolated between reads. An indexer without subscription support (custom `ArkadeIndexer` fakes) degrades to the previous polling behavior.
