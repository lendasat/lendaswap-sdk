---
"@lendasat/lendaswap-sdk-pure": patch
---

Send the `x-satora-server-version` compatibility header on SDK API
requests, deriving its value from the bundled OpenAPI document version so the
backend can enforce server/API semver compatibility.
