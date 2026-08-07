---
"@satora/swap": patch
---

Fix the x-satora-server-version header value: the previous release shipped `lendaswap@0.3.1` (not valid semver), which the server rejects. Now sends `0.3.1`.
