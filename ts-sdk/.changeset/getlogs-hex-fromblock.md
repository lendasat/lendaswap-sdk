---
"@satora/swap": patch
---

EVM tracking: send `eth_getLogs` with `fromBlock: 0x0` instead of the `"earliest"` tag, which strict RPCs (e.g. `arb1.arbitrum.io/rpc`) reject with `InvalidParamsRpcError` — breaking tracking startup for swaps with an Arbitrum leg.
