---
"@lendasat/lendaswap-sdk-pure": patch
---

Gate the on-chain Bitcoin refund on the chain's median time past rather than the
local clock. `CHECKLOCKTIMEVERIFY` with a timestamp locktime is evaluated against
median time past, so that is the value the precondition has to read: a clock
running fast would let a transaction through only for the node to reject it as
non-final, and one running slow would report a refund as unavailable while the
chain already accepts it. The message now reports both the locktime and the
chain's current median time.

The Arkade non-collaborative refund still reads the local clock; its timelock
semantics are Arkade's own and it is left unchanged here.
