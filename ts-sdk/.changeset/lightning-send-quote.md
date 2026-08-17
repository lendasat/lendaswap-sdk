---
"@satora/swap": minor
---

Exact Arkade → Lightning quotes: `getLightningSendQuote` and the
`lightningDestination` option on `getQuote` are delegated from the pure
SDK — quotes with a concrete destination (invoice / lightning address /
LNURL) carry the provider's real Lightning send fee instead of the flat
estimate.
