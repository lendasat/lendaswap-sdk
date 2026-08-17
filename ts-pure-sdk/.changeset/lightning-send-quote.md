---
"@lendasat/lendaswap-sdk-pure": minor
---

Exact Arkade → Lightning quotes. New `getLightningSendQuote` hits
`/quote/lightning-send` with a concrete destination (BOLT11 invoice,
lightning address or LNURL) and returns amounts priced with the
provider's real Lightning send fee — which the server now charges as the
swap's network fee instead of a config-flat estimate. `getQuote` accepts
an optional `lightningDestination` and serves Arkade → Lightning quotes
through the exact endpoint when it is set, falling back to the estimate
on failure.
