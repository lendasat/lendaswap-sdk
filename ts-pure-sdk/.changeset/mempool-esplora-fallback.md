---
"@lendasat/lendaswap-sdk-pure": minor
---

Add Esplora fallback URLs for Bitcoin lookups and broadcasts. Mainnet now defaults to mempool.space with blockstream.info as fallback, tried in order. `withEsploraUrl` / `ClientConfig.esploraUrl` accept a list of URLs. Requests carry per-endpoint timeouts (2s lookups, 10s broadcasts) so a hung explorer fails over instead of stalling the claim/refund flow.
