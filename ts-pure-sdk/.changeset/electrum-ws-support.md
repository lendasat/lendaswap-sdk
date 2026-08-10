---
"@lendasat/lendaswap-sdk-pure": minor
---

Electrum-over-WebSocket support for Bitcoin chain access. On mainnet the
client now defaults to Satora's Fulcrum (`wss://electrs.satora.io`, see
`DEFAULT_ELECTRUM_WS_URLS`); `withElectrumWsUrl()` overrides it, and other
networks stay Esplora-only unless a URL is set. HTLC output lookups and
broadcasts prefer Electrum over Esplora, and waiting for an HTLC funding
becomes push-driven via `blockchain.scripthash.subscribe` instead of polling.
Esplora remains the automatic fallback whenever the Electrum server errors.
Address UTXO lookups (both backends) now select the largest output instead of
the explorer's first, so a stray dust output at the public HTLC address can no
longer shadow the real deposit.
