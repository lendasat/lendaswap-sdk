---
"@satora/swap": patch
---

Tracking readers (Electrum and Esplora) now select the funding candidate as
the transaction paying the MOST to the HTLC address instead of the first one
listed. The address is public, so a stray dust payment could previously be
mistaken for the funding — observing the swap as underfunded/invalid and
suppressing auto-claim while the real deposit sat at the address.
