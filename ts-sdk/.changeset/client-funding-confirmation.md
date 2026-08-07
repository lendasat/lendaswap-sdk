---
"@satora/swap": minor
---

Wait for a confirmation on a client-funded Bitcoin HTLC.

The confirmation rule is now set per leg rather than once for the reader, because
the two directions are not symmetric. A funding the SERVER made stays claimable
at 0-conf: it does not double-spend its own HTLC, and waiting a block would stall
every claim by ~10 minutes. A funding the CLIENT made is read back under the rule
the server applies to it — the server does not act until the tx has a blocktime,
so observing it sooner reported the swap as funded while the other side was still
waiting, and the UI moved on to "server funding" that had not begun.

`bitcoin_to_evm` and `btc_to_arkade` client legs therefore observe as `mempool`
until confirmed, which is what `client_funding_confirmation` has always described
and what the wizard's `user-deposit-seen` step was written for; both were
unreachable while every funding read as confirmed on sight. `evm_to_bitcoin` is
unchanged.

`BitcoinChainReader.getHtlcFacts` takes an optional `minConfirmations` overriding
the reader's default for one address; `HtlcRef` carries it for Bitcoin legs. The
reader-wide `minConfirmations` still applies wherever a ref sets none.
