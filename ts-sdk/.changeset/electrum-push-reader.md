---
"@satora/swap": minor
---

Electrum-backed Bitcoin chain reader with push reconciles. With
`withElectrumWsUrl()` set, the tracker's Bitcoin manager reads HTLC state from
the Electrum server (fresher than public explorers) and re-verifies the moment
an address's history changes via `blockchain.scripthash.subscribe` — so a
server-funded swap claims in seconds instead of waiting on the poll cadence.
The Esplora reader remains the fallback on Electrum errors. Non-mainnet
deployments set `withBitcoinNetwork()` so Electrum address decoding uses the
right parameters.
