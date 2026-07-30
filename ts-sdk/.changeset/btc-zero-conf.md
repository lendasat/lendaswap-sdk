---
"@satora/swap": minor
---

Configurable Bitcoin confirmation policy for observation — default now
accepts 0-conf. A Bitcoin funding tx observes as `confirmed` (unlocking e.g.
the evm→bitcoin claim) as soon as it appears in the mempool, UNLESS it
signals RBF (BIP-125): a replaceable funding stays `mempool` until it
confirms, because the claim reveals the preimage against it. Restore the
previous strict behavior with `ClientBuilder.withBitcoinMinConfirmations(1)`;
values above 1 enforce block depth (the esplora reader fetches the tip
height to compute it).
