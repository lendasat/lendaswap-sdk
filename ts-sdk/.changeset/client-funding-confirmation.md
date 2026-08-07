---
"@satora/swap": minor
---

Client-funded Bitcoin HTLCs (`bitcoin_to_evm`, `btc_to_arkade`) now observe as
`mempool` until confirmed, matching when the server acts on them — so
`waitingOn: "client_funding_confirmation"` is actually reported instead of the
swap jumping straight to "server funding". Server-funded legs
(`evm_to_bitcoin`) remain claimable at 0-conf. `HtlcRef` carries an optional
per-leg `minConfirmations` for Bitcoin legs; the reader-wide default still
applies where a ref sets none.
