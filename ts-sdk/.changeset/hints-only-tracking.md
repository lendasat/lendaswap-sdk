---
"@satora/swap": minor
---

Tracking now runs on server status hints by default, with zero chain access
(TEMP while the chain monitors are being fixed). A new `HintTracker` feeds the
server's pushed `SwapStatus` straight into the action derivation; timelocks are
evaluated against the wall clock. Chain-verified tracking remains available via
`ClientBuilder.withChainVerifiedTracking()` and is still implied by
`withContractManagers`.
