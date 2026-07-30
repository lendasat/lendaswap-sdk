/**
 * The Arkade {@link ContractManager} — the stateful I/O adapter that observes a
 * swap's VHTLC via the Ark indexer.
 *
 * We deliberately do NOT use `@arkade-os/sdk`'s `ContractManager`: its vtxo
 * annotation calls `script.forfeit()` on every contract, but a VHTLC script has
 * no `forfeit()` leaf (it exposes `claim()`/`refund()`), so watching a VHTLC
 * through it throws. Instead we read vtxos directly by pkScript — exactly what
 * the legacy SDK's claim/refund paths do — and map them with the pure helpers in
 * `./arkade.js`.
 *
 * When the indexer supports script subscriptions (`RestIndexerProvider` does),
 * observations advance on PUSH: a subscription event for a tracked pkScript
 * triggers a targeted reconcile, and the tracker's periodic {@link refresh}
 * becomes a rate-limited safety net (stream gaps, missed events). Without
 * subscription support the manager degrades to pure polling via `refresh`.
 */
import { RestIndexerProvider, type VirtualCoin } from "@arkade-os/sdk";
import { hex } from "@scure/base";
import type { HtlcObservation } from "../actions/types.js";
import type { VirtualTxSource } from "./arkade.js";
import { arkadeObservation, fetchArkadeSpend } from "./arkade.js";
import type { ContractManager, HtlcRef, Ledger } from "./types.js";

/**
 * The Ark indexer surface the observer needs (RestIndexerProvider satisfies it).
 * The subscription trio is optional — present, it enables push-driven
 * observation; absent, the manager polls.
 */
export type ArkadeIndexer = VirtualTxSource & {
  getVtxos(opts: {
    scripts: string[];
    spendableOnly?: boolean;
  }): Promise<{ vtxos: VirtualCoin[] }>;
  subscribeForScripts?(
    scripts: string[],
    subscriptionId?: string,
  ): Promise<string>;
  unsubscribeForScripts?(
    subscriptionId: string,
    scripts?: string[],
  ): Promise<void>;
  getSubscription?(
    subscriptionId: string,
    abortSignal: AbortSignal,
  ): AsyncIterableIterator<{ scripts: string[] }>;
};

export type ArkadeCreateConfig = {
  /** Ark server base URL — used for the indexer. */
  serverUrl: string;
  /**
   * The current Bitcoin MTP (ms) for evaluating VHTLC timelocks. Typically
   * `async () => (await client.getMtp()).mtp * 1000`.
   */
  chainTime?: () => Promise<number>;
};

export type ArkadeContractManagerDeps = {
  indexer: ArkadeIndexer;
  /**
   * The current Bitcoin MTP (ms) — arkade CLTV timelocks are evaluated against
   * Bitcoin's clock, not the Ark server's. Optional: until wired, `chainNow()`
   * reports `undefined` and the tracker holds swaps as provisional.
   */
  chainTime?: () => Promise<number>;
  /**
   * Minimum ms between PASSIVE full rescans via `refresh()` while the push
   * subscription is live (targeted `reconcile` is never gated; without
   * subscription support every refresh scans, since polling is then the only
   * signal). Default 3 minutes; `0` disables the gate.
   */
  fallbackScanIntervalMs?: number;
  /** Backoff base (ms) before re-subscribing after a dropped stream. Default 2s. */
  resubscribeDelayMs?: number;
};

const DEFAULT_FALLBACK_SCAN_INTERVAL_MS = 180_000;
const MAX_RESUBSCRIBE_DELAY_MS = 60_000;

/** True when a vtxo is a live funding of the contract (not yet spent). */
function isFunded(vtxo: VirtualCoin): boolean {
  const { state } = vtxo.virtualStatus;
  return state === "preconfirmed" || state === "settled";
}

/**
 * The offchain txid that spent this contract's VHTLC, if any. Mirrors the backend
 * watcher (`unified_watcher.rs`), which keys spend detection on `arkTxId` — the
 * offchain Arkade tx whose input[0] condition witness carries the revealed
 * preimage. Falls back to `spentBy` (the checkpoint tx, which also reveals it) so
 * a spend is caught under either field: reading only `spentBy` silently missed
 * spent vtxos that expose the spend solely via `arkTxId`, leaving them classified
 * as `confirmed` forever (never emitting spent_claim/spent_refund).
 */
function spendTxid(vtxos: VirtualCoin[]): string | undefined {
  const spent = vtxos.find(
    (v) =>
      v.arkTxId || v.spentBy || v.isSpent || v.virtualStatus.state === "spent",
  );
  return spent?.arkTxId ?? spent?.spentBy;
}

export class ArkadeContractManager implements ContractManager {
  readonly ledger: Ledger = "arkade";

  readonly #indexer: ArkadeIndexer;
  readonly #chainTime?: () => Promise<number>;

  /** pkScript → the ref we're tracking. */
  readonly #refs = new Map<string, Extract<HtlcRef, { ledger: "arkade" }>>();
  /** pkScript → last known observation. */
  readonly #obs = new Map<string, HtlcObservation>();
  /** pkScript → the verified preimage recovered from a claim spend. */
  readonly #preimages = new Map<string, Uint8Array>();
  readonly #listeners = new Set<
    (ref: HtlcRef, state: HtlcObservation) => void
  >();

  /** Last MTP reading (ms) + when it was fetched, for extrapolation. */
  #now: { mtpMs: number; fetchedAtMs: number } | undefined;
  readonly #fallbackScanIntervalMs: number;
  readonly #resubscribeDelayMs: number;
  #lastScanStartedAt = 0;
  /** Push-subscription state; undefined until the first successful subscribe. */
  #subscriptionId: string | undefined;
  #streamAbort: AbortController | undefined;
  #streaming = false;

  private constructor(deps: ArkadeContractManagerDeps) {
    this.#indexer = deps.indexer;
    this.#chainTime = deps.chainTime;
    this.#fallbackScanIntervalMs =
      deps.fallbackScanIntervalMs ?? DEFAULT_FALLBACK_SCAN_INTERVAL_MS;
    this.#resubscribeDelayMs = deps.resubscribeDelayMs ?? 2_000;
  }

  static fromDeps(deps: ArkadeContractManagerDeps): ArkadeContractManager {
    return new ArkadeContractManager(deps);
  }

  /** Construct a manager backed by a `RestIndexerProvider` over the Ark server. */
  static async create(
    config: ArkadeCreateConfig,
  ): Promise<ArkadeContractManager> {
    const indexer = new RestIndexerProvider(config.serverUrl);
    return ArkadeContractManager.fromDeps({
      indexer,
      chainTime: config.chainTime,
    });
  }

  canObserve(ref: HtlcRef): boolean {
    // The Arkade server is always configured (default or override), so any Arkade
    // ref is observable.
    return ref.ledger === "arkade";
  }

  async register(ref: HtlcRef): Promise<void> {
    if (ref.ledger !== "arkade")
      throw new Error(
        `ArkadeContractManager can't track a '${ref.ledger}' HTLC`,
      );
    this.#refs.set(ref.script, ref);
    await this.#subscribeScript(ref.script);
  }

  async unregister(ref: HtlcRef): Promise<void> {
    if (ref.ledger !== "arkade") return;
    this.#refs.delete(ref.script);
    this.#obs.delete(ref.script);
    this.#preimages.delete(ref.script);
    if (this.#subscriptionId) {
      await this.#indexer
        .unsubscribeForScripts?.(this.#subscriptionId, [ref.script])
        .catch(() => {}); // best effort — events for it are ignored anyway
    }
    if (this.#refs.size === 0) this.#stopStream();
  }

  getState(ref: HtlcRef): HtlcObservation | undefined {
    return ref.ledger === "arkade" ? this.#obs.get(ref.script) : undefined;
  }

  chainNow(_ref: HtlcRef): number | undefined {
    // Arkade CLTV timelocks share one clock (Bitcoin MTP), so the ref is unused.
    if (!this.#now) return undefined;
    // Extrapolate between reads: MTP advances with wall-clock (lagging it by a
    // roughly constant margin), so the clock stays current without polling.
    // The worker re-verifies on-chain before acting on any flip this causes.
    return this.#now.mtpMs + Math.max(0, Date.now() - this.#now.fetchedAtMs);
  }

  onEvent(cb: (ref: HtlcRef, state: HtlcObservation) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  /**
   * The PASSIVE full rescan (the tracker's periodic tick). While the push
   * stream is live it is rate-limited to the fallback interval — a safety net,
   * not the signal; without subscription support every call scans.
   */
  async refresh(): Promise<void> {
    const gated =
      this.#streaming &&
      Date.now() - this.#lastScanStartedAt < this.#fallbackScanIntervalMs;
    if (!gated) {
      await this.#scanAll();
      return;
    }
    // Refs registered since the last scan have no observation yet — register()
    // itself never scans, so catch just them up without a full rescan.
    const fresh = [...this.#refs.values()].filter(
      (r) => !this.#obs.has(r.script),
    );
    if (fresh.length === 0) return;
    await this.#readClock();
    await Promise.all(fresh.map((ref) => this.#reconcileRef(ref)));
  }

  /** Targeted verify (hint / pre-action path) — never gated. */
  async reconcile(ref: HtlcRef): Promise<void> {
    if (ref.ledger !== "arkade") return;
    const tracked = this.#refs.get(ref.script);
    if (!tracked) return;
    await this.#readClock();
    await this.#reconcileRef(tracked);
  }

  dispose(): void {
    this.#stopStream();
    this.#listeners.clear();
  }

  /** The verified preimage recovered from a claim spend, if one was seen. */
  getPreimage(ref: HtlcRef): Uint8Array | undefined {
    return ref.ledger === "arkade"
      ? this.#preimages.get(ref.script)
      : undefined;
  }

  /** Read and store the MTP clock (with fetch time, for extrapolation). */
  async #readClock(): Promise<void> {
    if (!this.#chainTime) return;
    this.#now = { mtpMs: await this.#chainTime(), fetchedAtMs: Date.now() };
  }

  /** Full scan of every tracked ref (clock + vtxos). */
  async #scanAll(): Promise<void> {
    this.#lastScanStartedAt = Date.now();
    await this.#readClock();
    await Promise.all(
      [...this.#refs.values()].map((ref) => this.#reconcileRef(ref)),
    );
  }

  /** Add a script to the push subscription (no-op if the indexer can't push). */
  async #subscribeScript(script: string): Promise<void> {
    if (!this.#indexer.subscribeForScripts || !this.#indexer.getSubscription)
      return;
    try {
      this.#subscriptionId = await this.#indexer.subscribeForScripts(
        [script],
        this.#subscriptionId,
      );
      this.#ensureStream();
    } catch (error) {
      // Push is an optimization; polling still covers the swap.
      console.warn("Arkade: script subscription failed (will poll):", error);
    }
  }

  /** Start the single consume loop for the subscription stream, if not running. */
  #ensureStream(): void {
    if (this.#streaming || !this.#subscriptionId) return;
    this.#streaming = true;
    this.#streamAbort = new AbortController();
    void this.#consumeStream(this.#streamAbort.signal).finally(() => {
      this.#streaming = false;
    });
  }

  #stopStream(): void {
    this.#streamAbort?.abort();
    this.#streamAbort = undefined;
    this.#subscriptionId = undefined;
  }

  /**
   * Consume subscription events: any event touching a tracked pkScript triggers
   * a targeted reconcile (the event is only a TRIGGER — the reconcile re-reads
   * the vtxos, so a spurious or stale event is harmless). A dropped stream is
   * re-subscribed with backoff, followed by a full catch-up scan for whatever
   * the gap missed.
   */
  async #consumeStream(signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (!signal.aborted && this.#refs.size > 0) {
      try {
        const id = this.#subscriptionId;
        const getSubscription = this.#indexer.getSubscription;
        if (!id || !getSubscription) return;
        for await (const event of getSubscription.call(
          this.#indexer,
          id,
          signal,
        )) {
          attempt = 0;
          for (const script of event.scripts ?? []) {
            const ref = this.#refs.get(script);
            if (!ref) continue;
            void this.#reconcileRef(ref).catch((error) => {
              console.warn("Arkade: push-triggered reconcile failed:", error);
            });
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        console.warn("Arkade: subscription stream failed:", error);
      }
      if (signal.aborted || this.#refs.size === 0) return;

      // Stream ended: back off, re-subscribe everything fresh, then catch up on
      // whatever happened during the gap.
      attempt += 1;
      const delay = Math.min(
        this.#resubscribeDelayMs * 2 ** (attempt - 1),
        MAX_RESUBSCRIBE_DELAY_MS,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (signal.aborted) return;
      try {
        this.#subscriptionId = await this.#indexer.subscribeForScripts?.([
          ...this.#refs.keys(),
        ]);
        await this.#scanAll();
      } catch (error) {
        console.warn("Arkade: re-subscribe failed:", error);
      }
    }
  }

  /** Read the VHTLC's vtxos and map them to an observation. */
  async #reconcileRef(
    ref: Extract<HtlcRef, { ledger: "arkade" }>,
  ): Promise<void> {
    const { vtxos } = await this.#indexer.getVtxos({ scripts: [ref.script] });
    const spend = spendTxid(vtxos);
    if (spend) {
      const resolved = await fetchArkadeSpend(
        this.#indexer,
        spend,
        hex.decode(ref.preimageHash),
      );
      if (resolved) {
        if (resolved.spend === "claim")
          this.#preimages.set(ref.script, resolved.preimage);
        this.#set(
          ref.script,
          arkadeObservation({ funded: true, spend: resolved.spend }),
        );
        return;
      }
    }
    const funded = vtxos.filter(isFunded);
    const total = funded.reduce((sum, vtxo) => sum + vtxo.value, 0);
    this.#set(
      ref.script,
      arkadeObservation({
        funded: funded.length > 0,
        sufficient: total >= ref.expectedSats,
      }),
    );
  }

  /** Update an observation and notify on change; never downgrade a resolved spend. */
  #set(script: string, observation: HtlcObservation): void {
    const ref = this.#refs.get(script);
    if (!ref) return;
    const current = this.#obs.get(script);
    if (current === observation) return;
    // A resolved spend is terminal for the HTLC — a later funded/absent poll
    // (e.g. spent vtxos dropping out of the listing) must not undo it.
    const spendStates: HtlcObservation[] = ["spent_claim", "spent_refund"];
    if (
      current &&
      spendStates.includes(current) &&
      !spendStates.includes(observation)
    )
      return;
    this.#obs.set(script, observation);
    for (const listener of this.#listeners) listener(ref, observation);
  }
}
