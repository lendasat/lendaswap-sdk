/**
 * The Bitcoin {@link ContractManager} — the stateful I/O adapter that observes a
 * swap's on-chain HTLC by polling esplora.
 *
 * Modeled on the Arkade manager: reading is delegated to an injected
 * {@link BitcoinChainReader} (so the package stays free of a bundled esplora
 * client and the adapter is testable against a fake). Observation is on-demand —
 * {@link refresh} at seed time, targeted {@link reconcile}s from hints and the
 * tracker's at-risk safety net. The clock is Bitcoin MTP (the same source the
 * Arkade manager uses), so {@link chainNow} is ref-less.
 */
import { hex } from "@scure/base";
import type { HtlcObservation } from "../actions/types.js";
import { type BitcoinHtlcFacts, bitcoinObservation } from "./bitcoin.js";
import type { ContractManager, HtlcRef, Ledger } from "./types.js";

/** The esplora surface the observer needs (a `BitcoinReaderEsplora` satisfies it). */
export type BitcoinChainReader = {
  /** Funding + spend facts for an HTLC witness-script address. */
  getHtlcFacts(address: string): Promise<BitcoinHtlcFacts>;
};

export type BitcoinCreateConfig = {
  /** One or more esplora REST base URLs; several are tried in rotation with failover. */
  esploraUrl: string | string[];
  /** The current Bitcoin MTP (ms); typically `async () => (await client.getMtp()).mtp * 1000`. */
  chainTime?: () => Promise<number>;
  /**
   * Confirmations a funding tx needs before it observes as `confirmed`.
   * Default `0`: accept an unconfirmed funding unless it signals RBF
   * (BIP-125) — a replaceable funding stays `mempool` until it confirms,
   * since the claim reveals the preimage against it. `1` = wait for a block.
   */
  minConfirmations?: number;
};

export type BitcoinContractManagerDeps = {
  reader: BitcoinChainReader;
  chainTime?: () => Promise<number>;
};

export class BitcoinContractManager implements ContractManager {
  readonly ledger: Ledger = "bitcoin";

  readonly #reader: BitcoinChainReader;
  readonly #chainTime?: () => Promise<number>;

  /** address → the ref we're tracking. */
  readonly #refs = new Map<string, Extract<HtlcRef, { ledger: "bitcoin" }>>();
  /** address → last known observation. */
  readonly #obs = new Map<string, HtlcObservation>();
  /** address → the preimage a claim revealed. */
  readonly #preimages = new Map<string, Uint8Array>();
  readonly #listeners = new Set<
    (ref: HtlcRef, state: HtlcObservation) => void
  >();

  /** Last MTP reading (ms) + when it was fetched, for extrapolation. */
  #now: { mtpMs: number; fetchedAtMs: number } | undefined;

  private constructor(deps: BitcoinContractManagerDeps) {
    this.#reader = deps.reader;
    this.#chainTime = deps.chainTime;
  }

  static fromDeps(deps: BitcoinContractManagerDeps): BitcoinContractManager {
    return new BitcoinContractManager(deps);
  }

  static async create(
    config: BitcoinCreateConfig,
  ): Promise<BitcoinContractManager> {
    const { esploraReader } = await import("./bitcoin-reader-esplora.js");
    return BitcoinContractManager.fromDeps({
      reader: esploraReader(config.esploraUrl, undefined, {
        minConfirmations: config.minConfirmations,
      }),
      chainTime: config.chainTime,
    });
  }

  canObserve(ref: HtlcRef): boolean {
    // Esplora is always configured (default or override), so any Bitcoin ref is
    // observable.
    return ref.ledger === "bitcoin";
  }

  async register(ref: HtlcRef): Promise<void> {
    if (ref.ledger !== "bitcoin")
      throw new Error(
        `BitcoinContractManager can't track a '${ref.ledger}' HTLC`,
      );
    this.#refs.set(ref.address, ref);
    await this.#reconcileRef(ref);
  }

  async unregister(ref: HtlcRef): Promise<void> {
    if (ref.ledger !== "bitcoin") return;
    this.#refs.delete(ref.address);
    this.#obs.delete(ref.address);
    this.#preimages.delete(ref.address);
  }

  getState(ref: HtlcRef): HtlcObservation | undefined {
    return ref.ledger === "bitcoin" ? this.#obs.get(ref.address) : undefined;
  }

  chainNow(_ref: HtlcRef): number | undefined {
    // Bitcoin timelocks share one clock (MTP), so the ref is unused.
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

  async refresh(): Promise<void> {
    await this.#readClock();
    await Promise.all(
      [...this.#refs.values()].map((ref) => this.#reconcileRef(ref)),
    );
  }

  async reconcile(ref: HtlcRef): Promise<void> {
    if (ref.ledger !== "bitcoin") return;
    const tracked = this.#refs.get(ref.address);
    if (!tracked) return;
    await this.#readClock();
    await this.#reconcileRef(tracked);
  }

  /** Read and store the MTP clock (with fetch time, for extrapolation). */
  async #readClock(): Promise<void> {
    if (!this.#chainTime) return;
    this.#now = { mtpMs: await this.#chainTime(), fetchedAtMs: Date.now() };
  }

  dispose(): void {
    this.#listeners.clear();
  }

  /** The preimage a claim revealed on this HTLC, if one was seen. */
  getPreimage(ref: HtlcRef): Uint8Array | undefined {
    return ref.ledger === "bitcoin"
      ? this.#preimages.get(ref.address)
      : undefined;
  }

  async #reconcileRef(
    ref: Extract<HtlcRef, { ledger: "bitcoin" }>,
  ): Promise<void> {
    const facts = await this.#reader.getHtlcFacts(ref.address);
    const { observation, preimage } = bitcoinObservation(
      facts,
      hex.decode(ref.preimageHash),
      ref.expectedSats,
    );
    if (preimage) this.#preimages.set(ref.address, preimage);
    this.#set(ref.address, observation);
  }

  /** Update an observation and notify on change; never downgrade a resolved spend. */
  #set(address: string, observation: HtlcObservation): void {
    const ref = this.#refs.get(address);
    if (!ref) return;
    const current = this.#obs.get(address);
    if (current === observation) return;
    const spendStates: HtlcObservation[] = ["spent_claim", "spent_refund"];
    if (
      current &&
      spendStates.includes(current) &&
      !spendStates.includes(observation)
    )
      return;
    this.#obs.set(address, observation);
    for (const listener of this.#listeners) listener(ref, observation);
  }
}
