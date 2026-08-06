---
"@satora/swap": minor
---

Track EVM HTLCs by swap key.

`HTLCErc20` now carries `key` — the commitment to a swap's full parameter set —
on all three lifecycle events, and the reader's event ABIs move with it. This is
a breaking change on the wire: the new signatures hash to different topic0
selectors, so a build without it sees no events at all from a `VERSION 4`
contract, silently, and every swap on it reads as never funded. Release this
together with the contract it reads.

`EvmHtlcQuery` gains an optional `terms` field (`amount`, `token`, `sender`,
`timelockSec`). With it the reader derives the expected swap key and attributes
settlements on that instead of on `preimageHash`, which identifies no single
swap — any number may share one hash, each with its own terms and lifecycle.
`EvmContractManager` fills `terms` in from the ref whenever the swap response
exposed the whole tuple, the same condition that already enables the `isActive`
fast path; without it, settlements are read as before. `SwapCreated` keeps its
`claimAddress` check, since it is the event that first reports the funded amount
and so its key is not predictable in advance.
