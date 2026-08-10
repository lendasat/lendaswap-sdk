---
"@lendasat/lendaswap-sdk-pure": minor
---

Electrum-over-WebSocket support for Bitcoin chain access. `withElectrumWsUrl()`
points the client at a Fulcrum `ws`/`wss` endpoint: HTLC output lookups and
broadcasts prefer it over Esplora, and waiting for an HTLC funding becomes
push-driven via `blockchain.scripthash.subscribe` instead of polling. Esplora
remains the automatic fallback whenever the Electrum server errors. Address
UTXO lookups (both backends) now select the largest output instead of the
explorer's first, so a stray dust output at the public HTLC address can no
longer shadow the real deposit.
