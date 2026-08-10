---
"@satora/swap": minor
---

Electrum-backed Bitcoin chain reader with push reconciles, on by default for
mainnet (Satora's Fulcrum; `withElectrumWsUrl()` overrides, other networks
stay Esplora-only unless a URL is set). The tracker's Bitcoin manager reads
HTLC state from the Electrum server (fresher than public explorers) and
re-verifies the moment an address's history changes via
`blockchain.scripthash.subscribe` — so a server-funded swap claims in seconds
instead of waiting on the poll cadence. The Esplora reader remains the
fallback on Electrum errors. Non-mainnet deployments set
`withBitcoinNetwork()` so Electrum address decoding uses the right parameters.
