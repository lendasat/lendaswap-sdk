---
"@satora/swap": minor
---

Track EVM HTLCs by swap key.

`HTLCErc20` carries `key` — the commitment to a swap's full parameter set — on
all three lifecycle events, and the reader's event ABIs move with it. This is a
breaking change on the wire: the signatures hash to different topic0 selectors,
so this release reads a `VERSION 4` contract and earlier releases do not. Ship it
together with the contract it reads.

A swap is identified by its key. `preimageHash` is an indexed topic that narrows
a log scan; it names no single HTLC, since any number may share one hash with
independent terms and lifecycles.

`EvmHtlcQuery` gains an optional `terms` field (`amount`, `token`, `sender`,
`timelockSec`). With it the reader derives the swap key and attributes
settlements on that. `EvmContractManager` fills `terms` in from the ref whenever
the swap response exposes the whole tuple — the same condition that enables the
`isActive` fast path. `SwapCreated` is matched on its `claimAddress` instead,
being the event that first reports the funded amount, so its key is not
predictable in advance.

`htlcKey` and `htlcQueryKey` carry the contract address and, where the response
exposes them, the rest of the tuple. Two HTLCs sharing a hash therefore hold
distinct entries in a manager's tracked refs, observations and preimages, and
distinct entries in a batch result. Both keys are in-memory only; nothing
persisted changes.

Attribution requires the tuple. A leg whose swap response omits one of those
fields cannot derive its key — and `isActive` needs the same tuple, so there is
no second route — and so reports no settlement rather than an uncertain one.
Legs carrying the full tuple, the normal case, are unaffected.
