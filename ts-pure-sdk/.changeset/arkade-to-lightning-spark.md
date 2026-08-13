---
"@lendasat/lendaswap-sdk-pure": minor
---

Arkade→Lightning swaps, rebuilt on the Spark provider.

- New `createArkadeToLightningSwap` (and a `createSwap` dispatcher route):
  destination is one of `lightningInvoice` (its amount pins the payout),
  or `lightningAddress`/`lnurl` with exactly one of `sourceAmountSats`
  (send-max, fees deducted from the payout) or `targetAmountSats` (exact
  payout, fees added on top). The swap's hash lock is the invoice's
  payment hash; the derived swap key only signs refunds.
- `refundSwap()` and `amountsForSwap()` accept `arkade_to_lightning`
  swaps — collaborative refund first (server cosigns, no locktime wait),
  unilateral fallback.
- Fee model: the user pays `payout + protocol fee + flat network fee`;
  the provider's actual Lightning fee is paid out of that margin, so
  quote and create can never disagree. `SwapPairInfo` gains
  `network_fee_sats`, `NetworkFee` gains `flat_sats`, and
  `composeQuote()` folds the flat fee into `network_fee`.
