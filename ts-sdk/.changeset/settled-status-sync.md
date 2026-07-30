---
"@satora/swap": patch
---

Persist the settled status when the chain says a swap is finished. A swap that
settled while the app was closed kept its stale active status in storage, so
`startTracking` re-tracked and re-scanned it once per session forever. The
client now watches its own action stream: on a terminal (`none`) derivation
for a swap whose stored status still reads active, it re-fetches the swap with
`updateStorage: true`, so the next session's settled-status filter skips it.
Deduped per session; a swap whose stored status is already settled costs no
server call.
