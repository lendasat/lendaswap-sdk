---
"@lendasat/lendaswap-sdk-pure": minor
---

Sign `HTLCErc20` EIP-712 payloads against domain version `"4"`, tracking the
contract's `VERSION` bump. The domain version is part of the digest, so a
signature produced against the old value recovers the wrong `claimAddress` and
the settlement reverts with `HTLC: swap not found` — this must be released
together with the contract it signs for. `HTLCCoordinator` is a separate domain
and stays on `"3"`.
