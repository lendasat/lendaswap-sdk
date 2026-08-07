---
"@satora/swap": minor
---

Read the `key` field on `HTLCErc20` lifecycle events.

`HTLCErc20` carries `key` — the commitment to a swap's full parameter set — on
all three lifecycle events, and the reader's event ABIs move with it. This is a
breaking change on the wire: the signatures hash to different topic0 selectors,
so this release reads a `VERSION 4` contract and earlier releases do not. Ship it
together with the contract it reads.

`EvmHtlcQuery` gains an optional `terms` field (`amount`, `token`, `sender`,
`timelockSec`), which `EvmContractManager` fills in from the ref whenever the
swap response exposes the whole tuple — the same condition that enables the
`isActive` fast path.

`htlcKey` and `htlcQueryKey` carry the contract address and, where the response
exposes them, the rest of the tuple. Two HTLCs sharing a preimage hash therefore
hold distinct entries in a manager's tracked refs, observations and preimages,
and distinct entries in a batch result, rather than one overwriting the other.
`htlcKey` previously omitted the contract address, so two legs on one chain at
different HTLC contracts shared an entry. Both keys are in-memory only; nothing
persisted changes.

Settlements continue to be reported on the preimage hash their log filter
matched. A swap's own tuple does not derive the key of the HTLC that was funded
for it: a coordinator locks its post-swap balance rather than the quoted amount,
and the contract records the coordinator as sender rather than the funder named
on the swap. The `isActive` check, whose tuple does hold for a server-funded leg,
remains what keeps an open HTLC from reading as settled.
