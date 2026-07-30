---
"@satora/swap": minor
---

Machine-readable action semantics: `WaitAction` gains `waitingOn`
(`"client_payment" | "client_funding_confirmation" | "server_funding" | "claim_confirmation" | "refund_timelock"`) and `NoneAction` gains `outcome`
(`"completed" | "refunded" | "expired"`). A consumer can now pick the right
surface — invoice page, "deposit seen…", processing, refund countdown,
success/refunded/expired — by switching on typed fields instead of
re-deriving intent from `status` + `observations` (the inference our own
frontend got wrong twice). One caveat is documented on `waitingOn`:
`client_payment` covers the whole Lightning-funded window, because the chain
cannot see whether the invoice was already paid — refine with the server
status if you render those as separate screens. Breaking only for code that
CONSTRUCTS these action variants; consumers of the union are unaffected.
