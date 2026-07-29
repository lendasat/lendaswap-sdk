/**
 * The EVM {@link ContractManager} — the stateful I/O adapter that observes
 * `HTLCErc20` swaps across one or more EVM chains.
 *
 * Reading chain state is delegated to an injected {@link EvmChainReader} (one per
 * chainId) rather than a bundled viem/ethers client, so the swap package stays
 * chain-library-agnostic and this adapter is testable against a fake. The pure
 * event→observation mapping lives in `./evm.js`.
 *
 * Unlike Arkade, EVM spans multiple chains with independent `block.timestamp`
 * clocks, so this manager is chain-aware: it routes each ref by `chainId` and
 * {@link chainNow} is ref-scoped.
 */
import type { HtlcObservation } from "../actions/types.js";
import { type EvmHtlcEvent, evmObservation } from "./evm.js";
import {
  type ContractManager,
  type HtlcRef,
  htlcKey,
  type Ledger,
} from "./types.js";

type EvmRef = Extract<HtlcRef, { ledger: "evm" }>;

/** Identifies one HTLC to read: contract + preimageHash (+ the claim guard). */
export type EvmHtlcQuery = {
  htlc: `0x${string}`;
  preimageHash: `0x${string}`;
  /** A `SwapCreated` counts only when it pays this address (term check). */
  claimAddress: `0x${string}`;
};

/** The result key for one {@link EvmHtlcQuery} in a batch. */
export function htlcQueryKey(q: {
  htlc: `0x${string}`;
  preimageHash: `0x${string}`;
}): string {
  return `${q.htlc.toLowerCase()}:${q.preimageHash.toLowerCase()}`;
}

/** Reads `HTLCErc20` state for one EVM chain. Implemented over viem/ethers/etc. */
export type EvmChainReader = {
  /**
   * The decoded lifecycle events for every queried HTLC, keyed by
   * {@link htlcQueryKey}. Batched so a whole chain scan costs one RPC request
   * regardless of how many swaps are tracked; a queried HTLC with no events maps
   * to an empty array.
   */
  getHtlcEventsBatch(
    queries: EvmHtlcQuery[],
  ): Promise<Map<string, EvmHtlcEvent[]>>;
  /** The latest block's `block.timestamp`, in ms. */
  getBlockTimeMs(): Promise<number>;
};

export type EvmContractManagerDeps = {
  /** A chain reader per EVM `chainId` this manager serves. */
  readers: Map<number, EvmChainReader>;
  /**
   * Minimum ms between PASSIVE full-chain rescans (the tracker's periodic
   * `refresh()`). Targeted verifies — `register` and `reconcile(ref)`, i.e. the
   * hint/auto-claim path — are never gated. The passive scan is only the safety
   * net for a missed hint, so it can be slow; this is what keeps background
   * traffic against rate-limited public RPCs near zero. Default 3 minutes;
   * `0` disables the gate (scan on every refresh — tests).
   */
  fallbackScanIntervalMs?: number;
};

const DEFAULT_FALLBACK_SCAN_INTERVAL_MS = 180_000;

/** A chain clock reading: block.timestamp plus when we fetched it. */
type ChainClock = { blockTimeMs: number; fetchedAtMs: number };

export class EvmContractManager implements ContractManager {
  readonly ledger: Ledger = "evm";

  readonly #readers: Map<number, EvmChainReader>;
  readonly #fallbackScanIntervalMs: number;
  /** htlcKey → the ref we're tracking. */
  readonly #refs = new Map<string, EvmRef>();
  /** htlcKey → last known observation. */
  readonly #obs = new Map<string, HtlcObservation>();
  /** htlcKey → the preimage a claim revealed. */
  readonly #preimages = new Map<string, `0x${string}`>();
  /** chainId → its last clock reading (extrapolated in {@link chainNow}). */
  readonly #now = new Map<number, ChainClock>();
  /** chainId → when its last full scan STARTED (gates passive rescans). */
  readonly #lastScanStartedAt = new Map<number, number>();
  readonly #listeners = new Set<
    (ref: HtlcRef, state: HtlcObservation) => void
  >();

  private constructor(deps: EvmContractManagerDeps) {
    this.#readers = deps.readers;
    this.#fallbackScanIntervalMs =
      deps.fallbackScanIntervalMs ?? DEFAULT_FALLBACK_SCAN_INTERVAL_MS;
  }

  static fromDeps(deps: EvmContractManagerDeps): EvmContractManager {
    return new EvmContractManager(deps);
  }

  canObserve(ref: HtlcRef): boolean {
    return ref.ledger === "evm" && this.#readers.has(ref.chainId);
  }

  async register(ref: HtlcRef): Promise<void> {
    if (ref.ledger !== "evm")
      throw new Error(`EvmContractManager can't track a '${ref.ledger}' HTLC`);
    // Fail loudly on an unconfigured chain rather than storing a ref we can never
    // observe (its state/clock would stay undefined and the tracker would wait on
    // it forever). The caller must add the chain via ClientBuilder.withEvmRpcUrls().
    if (!this.#readers.has(ref.chainId))
      throw new Error(
        `no EVM reader for chain ${ref.chainId} — configure it via ClientBuilder.withEvmRpcUrls()`,
      );
    this.#refs.set(htlcKey(ref), ref);
    await this.#reconcileChain(ref.chainId);
  }

  async unregister(ref: HtlcRef): Promise<void> {
    if (ref.ledger !== "evm") return;
    const key = htlcKey(ref);
    this.#refs.delete(key);
    this.#obs.delete(key);
    this.#preimages.delete(key);
    // Drop the chain's state once nothing on it is tracked anymore.
    if (![...this.#refs.values()].some((r) => r.chainId === ref.chainId)) {
      this.#now.delete(ref.chainId);
      this.#lastScanStartedAt.delete(ref.chainId);
    }
  }

  getState(ref: HtlcRef): HtlcObservation | undefined {
    return ref.ledger === "evm" ? this.#obs.get(htlcKey(ref)) : undefined;
  }

  chainNow(ref: HtlcRef): number | undefined {
    if (ref.ledger !== "evm") return undefined;
    const clock = this.#now.get(ref.chainId);
    if (!clock) return undefined;
    // Extrapolate between reads: EVM block.timestamp tracks wall-clock closely,
    // so the clock stays current without polling `getBlock`. This is what lets a
    // timelock flip (e.g. refund unlocking) surface between slow scans; the
    // worker re-verifies against the real chain before ever acting on it.
    return clock.blockTimeMs + Math.max(0, Date.now() - clock.fetchedAtMs);
  }

  onEvent(cb: (ref: HtlcRef, state: HtlcObservation) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  /**
   * The PASSIVE safety-net scan, called on the tracker's periodic tick. Gated
   * per chain by `fallbackScanIntervalMs`: most ticks are free no-ops, because
   * the hint feed (`reconcile`) covers timely reaction and {@link chainNow}
   * extrapolates the clock in between.
   */
  async refresh(): Promise<void> {
    const chainIds = new Set([...this.#refs.values()].map((r) => r.chainId));
    const now = Date.now();
    const due = [...chainIds].filter((c) => {
      const last = this.#lastScanStartedAt.get(c);
      return last === undefined || now - last >= this.#fallbackScanIntervalMs;
    });
    await Promise.all(due.map((c) => this.#reconcileChain(c)));
  }

  /** Targeted verify (hint / pre-action path) — never gated. */
  async reconcile(ref: HtlcRef): Promise<void> {
    if (ref.ledger !== "evm") return;
    const tracked = this.#refs.get(htlcKey(ref));
    if (!tracked) return;
    const reader = this.#readers.get(tracked.chainId);
    if (!reader) return;
    await this.#readClock(reader, tracked.chainId);
    await this.#reconcileRefs(reader, [tracked]);
  }

  dispose(): void {
    this.#listeners.clear();
  }

  /** The preimage a claim revealed on this HTLC, if one was seen. */
  getPreimage(ref: HtlcRef): `0x${string}` | undefined {
    return ref.ledger === "evm" ? this.#preimages.get(htlcKey(ref)) : undefined;
  }

  /** Read and store a chain's clock (with its fetch time, for extrapolation). */
  async #readClock(reader: EvmChainReader, chainId: number): Promise<void> {
    const blockTimeMs = await reader.getBlockTimeMs();
    this.#now.set(chainId, { blockTimeMs, fetchedAtMs: Date.now() });
  }

  /** Refresh one chain's clock and re-observe every HTLC tracked on it. */
  async #reconcileChain(chainId: number): Promise<void> {
    const reader = this.#readers.get(chainId);
    if (!reader) return;
    this.#lastScanStartedAt.set(chainId, Date.now());
    await this.#readClock(reader, chainId);
    const refs = [...this.#refs.values()].filter((r) => r.chainId === chainId);
    await this.#reconcileRefs(reader, refs);
  }

  /** Re-observe the given refs from one batched log read. */
  async #reconcileRefs(reader: EvmChainReader, refs: EvmRef[]): Promise<void> {
    if (refs.length === 0) return;
    const events = await reader.getHtlcEventsBatch(
      refs.map((r) => ({
        htlc: r.htlc,
        preimageHash: r.preimageHash,
        claimAddress: r.claimAddress,
      })),
    );
    for (const ref of refs) {
      const { observation, preimage } = evmObservation(
        events.get(htlcQueryKey(ref)) ?? [],
        { amount: ref.expectedAmount, token: ref.expectedToken },
      );
      const key = htlcKey(ref);
      if (preimage) this.#preimages.set(key, preimage);
      this.#set(key, observation);
    }
  }

  /** Update an observation and notify on change; never downgrade a resolved spend. */
  #set(key: string, observation: HtlcObservation): void {
    const ref = this.#refs.get(key);
    if (!ref) return;
    const current = this.#obs.get(key);
    if (current === observation) return;
    const spendStates: HtlcObservation[] = ["spent_claim", "spent_refund"];
    if (
      current &&
      spendStates.includes(current) &&
      !spendStates.includes(observation)
    )
      return;
    this.#obs.set(key, observation);
    for (const listener of this.#listeners) listener(ref, observation);
  }
}
