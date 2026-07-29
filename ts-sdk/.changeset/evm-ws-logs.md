---
"@satora/swap": patch
---

EVM tracking gains chain-level push: one `eth_subscribe("logs")` WebSocket subscription per chain (free wss endpoints — publicnode, dRPC — rotated on reconnect), using the same batched filter as the reader. A pushed log identifies the exact HTLC that changed and triggers one targeted verify; every (re)connect triggers a chain catch-up scan, and the rate-limited passive scan still backstops a silently dead socket. Connections are lazy — no socket while a chain has no tracked swaps — and the subscription is trust-free: pushes only trigger verification, chain reads stay the truth.
