# @satora/swap

## 0.3.2

### Patch Changes

- 9153ac2: Fix the x-satora-server-version header value: the previous release shipped `lendaswap@0.3.1` (not valid semver), which the server rejects. Now sends `0.3.1`.

## 0.3.1

### Patch Changes

- 75f4743: Target backend lendaswap@0.3.1 in the x-satora-server-version header.

## 0.3.0

### Minor Changes

- 573eec6: Chain-derived swap tracking.

  - `WaitAction` gains `waitingOn`
    (`"client_payment" | "client_funding_confirmation" | "server_funding" | "claim_confirmation" | "refund_timelock"`)
    and terminal `NoneAction` gains `outcome`
    (`"completed" | "refunded" | "expired"`). Tracker emissions also carry
    `observations` — the raw chain facts the actions were derived from.
  - Tracking is now push-driven via the server's status WebSocket (observe mode
    included), with each pushed transition verified on-chain; background polling
    is gone. While client funds are locked on-chain, an independent watcher
    re-verifies both legs every 60s, so refund availability never depends on the
    server.
  - Bitcoin funding is treated as confirmed at 0-conf by default, so
    evm→bitcoin swaps claim immediately.
    `ClientBuilder.withBitcoinMinConfirmations(n)` restores block-depth
    policies.
  - `startTracking()` is safe to call concurrently; settled swaps persist their
    final status so later sessions skip them; a swap that stays unfunded past
    its refund locktime derives a terminal `expired`.

- 31484e1: Client-funded Bitcoin HTLCs (`bitcoin_to_evm`, `btc_to_arkade`) now observe as
  `mempool` until confirmed, matching when the server acts on them — so
  `waitingOn: "client_funding_confirmation"` is actually reported instead of the
  swap jumping straight to "server funding". Server-funded legs
  (`evm_to_bitcoin`) remain claimable at 0-conf. `HtlcRef` carries an optional
  per-leg `minConfirmations` for Bitcoin legs; the reader-wide default still
  applies where a ref sets none.
- 1c027f8: Read the `key` field on `HTLCErc20` lifecycle events. The event signatures
  change, so this release reads a `VERSION 4` contract and earlier releases do
  not — ship it together with the contract it reads.

## Unreleased

### Patch Changes

- Send `x-satora-server-version` on API requests via the underlying pure SDK. The header is the semver server/API version the SDK was built against.

## 0.2.0

### Minor Changes

- e2271fe: Expose refunded EVM-source swap continuation APIs through the migrated swap SDK. `getRefundedEvmSwapContinuation` reports whether a refunded EVM-source swap has recoverable Kernel-account balance, and `continueRefundedEvmSwap` creates and funds a replacement swap from that balance.
- 9d35eee: Hint-driven auto-claim and more resilient tracking.

  - **Opt-in auto-claim** via `ClientBuilder.withAutoClaim({ onActionRequired? })`. When enabled, tracking also subscribes to the server's status WebSocket (a faster trigger than the chain poll) and, once the chain confirms a swap is claimable, claims it automatically. Actions that need the user — a manual `fund`, or a refund to confirm — are surfaced through `onActionRequired` instead of being run. Off by default, since it spends on the user's behalf.
  - **Track-on-create**: a swap created after `startTracking` is now folded into tracking (and auto-claimed) without a restart — every `create*` method routes through the hook.
  - **Unreachable chains no longer break tracking**: a swap with a leg on an unconfigured chain (e.g. an EVM chain with no RPC) is skipped at `startTracking` instead of aborting tracking for every other swap, and `create*` throws rather than letting you fund a swap that can be neither observed nor claimed.

  **Breaking:** `ContractManager` now requires a `canObserve(ref)` method. Only affects code that implements `ContractManager` directly (e.g. via `ClientBuilder.withContractManagers`); the built-in managers already provide it.

  Also fixes: the WebSocket subscription cap is now enforced client-side (overflow was silently dropped by the server), `SwapTracker.track()` rolls back a partial registration on failure, and the worker no longer surfaces the no-op `wait` action as one needing attention.

## 0.1.0

### Minor Changes

- 1db87ef: `@satora/swap` is now a standalone, drop-in swap client instead of a bare
  re-export of `@lendasat/lendaswap-sdk-pure`. `Client` and `ClientBuilder` wrap
  the underlying legacy client with the exact same public API, and this is where
  new Satora-native features will land.

  **This is the recommended swap package going forward.** We intend to deprecate
  `@lendasat/lendaswap-sdk-pure` and migrate all consumers over to `@satora/swap`.
  Migrating is a drop-in change — swap the package name in your imports, nothing
  else changes. The legacy package stays supported throughout the transition.

- 80b3047: Add a derived next-action model with observe-mode tracking, so consumers no
  longer have to re-infer UX from the raw 16-state `SwapStatus`.

  Call `client.startTracking()` and subscribe with `client.subscribeToActions(cb)`
  to receive the recommended next action for each of your swaps — `fund`, `wait`,
  `claim`, `refund`, or `none` — recomputed as the chain state changes. The state
  is derived **purely from on-chain observations** (per-ledger contract managers
  watching each HTLC), never from the server's status, so it also works for
  recovery when the API is unavailable. Each leg's funding amount, token and
  recipient are verified, so the client is never told to claim a leg funded on the
  wrong terms.

  Covers every swap direction: Arkade↔EVM, Bitcoin↔EVM, `btc_to_arkade`, and all
  four Lightning directions. Tracking is on by default (with sensible RPC, esplora,
  and Arkade endpoints) and is overridable or disableable via the `Client` builder.

## 0.0.5

### Patch Changes

- 9f4d595: Add package READMEs for `@satora/escrow` and `@satora/swap`.
- bbba274: Add package README (published to npm).

## 0.0.5-rc.0

### Patch Changes

- 9f4d595: Add package READMEs for `@satora/escrow` and `@satora/swap`.
- bbba274: Add package README (published to npm).
