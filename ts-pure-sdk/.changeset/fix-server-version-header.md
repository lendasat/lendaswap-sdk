---
"@lendasat/lendaswap-sdk-pure": patch
---

Fix the x-satora-server-version header value: 0.6.1 shipped `lendaswap@0.3.1` (not valid semver), which the server rejects. Now sends `0.3.1`.
