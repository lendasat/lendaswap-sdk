# @lendasat/lendaswap-sdk-pure

## 0.6.0

### Minor Changes

- 68a0db7: Sign `HTLCErc20` EIP-712 payloads against domain version `"4"`, matching the
  contract's `VERSION` bump. This release must ship together with the v4
  contract. `HTLCCoordinator` is a separate domain and stays on `"3"`.
- 6b830dd: `CreateSwapOptions` gains `bridgeRecipient` (the destination USDC ATA) and
  `bridgeRecipientWallet` (the owning wallet, only when the ATA still needs
  creation). Both are persisted on the `StoredSwap`, so a bare `claim(swapId)`
  now works for BTC→USDC-on-Solana (CCTP) swaps; explicit claim options still
  take precedence. Also pins `dexie` to an exact version to avoid
  duplicate-instance errors in monorepos.

### Patch Changes

- 6f866d2: Gate the on-chain Bitcoin refund on the chain's median time past instead of
  the local clock, so refund availability matches what the chain actually
  accepts.

## Unreleased

### Patch Changes

- Add `x-satora-server-version` to SDK API requests. The header is the semver server/API version the SDK was built against.

## 0.5.0

### Minor Changes

- 70976d8: Add Esplora fallback URLs for Bitcoin lookups and broadcasts. Mainnet now defaults to mempool.space with blockstream.info as fallback, tried in order. `withEsploraUrl` / `ClientConfig.esploraUrl` accept a list of URLs. Requests carry per-endpoint timeouts (2s lookups, 10s broadcasts) so a hung explorer fails over instead of stalling the claim/refund flow.
- e2271fe: Add SDK support for continuing refunded EVM-source swaps. New APIs expose continuation eligibility, detect refunded balances in the Kernel account, create a replacement EVM-to-Arkade, EVM-to-Bitcoin, or EVM-to-Lightning swap, and submit the replacement funding UserOp from the recovered balance.

  Add a balance-funding CCTP inbound UserOp path for swaps whose funds are already in the Kernel account. This skips `receiveMessage` and submits the `approve(Permit2) + executeAndCreateWithPermit2` batch.

  Support split account-abstraction endpoints. `AaConfig` now accepts an optional `rpcUrl` for normal chain reads while `bundlerUrl` is used for UserOps, and `paymasterPolicyId` is optional so callers can send self-funded UserOps when no paymaster is configured.

### Patch Changes

- ea456e6: Improve the collaborative EVM refund error when the recorded depositor address is missing.
- 10c95ce: Validate Arkade addresses before creating swaps. `createBitcoinToArkadeSwap`, `createLightningToArkadeSwap`, and `createEvmToArkadeSwapGeneric` now throw early on a malformed target address instead of sending it to the server. Adds `parseArkadeAddress` (returns the decoded `ArkAddress`) and `isValidArkadeAddress` helpers (full bech32m decode, optional network check).

## 0.4.0

### Minor Changes

- e42e8c8: Add an optional `invoiceDescription` to `createLightningToEvmSwapGeneric` and `createLightningToArkadeSwap`.

  Sets the text shown in the payer's wallet when they open the Lightning invoice. When omitted, the server applies a branded default (e.g. `Satora swap to USDC on Optimism`); an explicit empty string blanks the description. Backed by the new optional `invoice_description` field on the `POST /swap/lightning/evm` and `POST /swap/lightning/arkade` endpoints.

### Patch Changes

- 1db87ef: Recommend `@satora/swap` for new code. This is now the legacy SDK — it stays
  fully supported, but `@satora/swap` is a drop-in replacement (same API; just
  change the package name in your imports) and is where new features land. We
  intend to deprecate this package and migrate consumers over to `@satora/swap`.
- eb07502: Regenerate the OpenAPI types (adding the `btc_to_arkade` and Lightning swap
  response fields) and align `@arkade-os/sdk` to `^0.4.45`.
- 57a0d76: Fix gasless EVM collaborative refunds to sign with the actual coordinator depositor key.

## 0.3.0

### Minor Changes

- 43a6fc7: Add `getBulkStatus(ids)` to fetch the status of many swaps in a single request.

  Returns `{ statuses, not_found }` — only each swap's status, so the whole batch is served by one database query. Unknown IDs are returned in `not_found` instead of throwing, so one bad ID does not fail the whole call. Backed by the new `POST /swap/bulk-status` endpoint (max 100 IDs per request).

- 9f4d595: Add support for EURe in Arbitrum.
  SDK uses new orchestration flow.

### Patch Changes

- 0fb68c7: Export the real SDK version from the package entry point. `SDK_VERSION`, `SDK_NAME`, and `CLIENT_AGENT` are now re-exported from the index (sourced from the generated `version.ts`); the stale hard-coded `VERSION = "0.0.1"` export is removed.
- ed3d6d8: Export `SDK_COMMIT_HASH` — the git commit the SDK was built from. It's injected into the generated `version.ts` at build time from the `GIT_COMMIT_HASH` env var (set in CI on publish, same convention as the backend), and defaults to `"unknown"` for local builds. Lets consumers report the exact SDK source revision (e.g. in a version footer).

## 0.3.0-rc.2

### Patch Changes

- ed3d6d8: Export `SDK_COMMIT_HASH` — the git commit the SDK was built from. It's injected into the generated `version.ts` at build time from the `GIT_COMMIT_HASH` env var (set in CI on publish, same convention as the backend), and defaults to `"unknown"` for local builds. Lets consumers report the exact SDK source revision (e.g. in a version footer).

## 0.3.0-rc.1

### Patch Changes

- 0fb68c7: Export the real SDK version from the package entry point. `SDK_VERSION`, `SDK_NAME`, and `CLIENT_AGENT` are now re-exported from the index (sourced from the generated `version.ts`); the stale hard-coded `VERSION = "0.0.1"` export is removed.

## 0.3.0-rc.0

### Minor Changes

- 9f4d595: Add support for EURe in Arbitrum.
  SDK uses new orchestration flow.
