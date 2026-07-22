/**
 * The reactive orchestration.
 *
 * A {@link SwapTracker} watches each tracked swap's on-chain HTLC leg(s) via
 * per-ledger {@link ContractManager}s (two legs for chain↔chain swaps, one for
 * Lightning). On any change it recomputes the next action
 * (`deriveSwapStatus` → `deriveSwapActions`), and — deduped — notifies
 * subscribers, dropping a swap once it reaches a terminal state.
 *
 * This is the observe-mode layer: it *notifies*. Auto-execution (recover/auto
 * mode running the action) is a policy layer built on top of these same
 * notifications, gated by each action's `automation`.
 */
import { deriveSwapActions } from "../actions/derive.js";
import { deriveSwapStatus } from "../actions/status.js";
import type { HtlcObservation, SwapActions } from "../actions/types.js";
import type { ContractManager, HtlcRef, Ledger } from "../contracts/types.js";

/**
 * A swap the tracker watches: its HTLC legs + refund locktimes (from the recovery
 * bundle). Chain↔chain swaps have both legs; Lightning swaps have exactly one
 * on-chain leg (the other side is an off-chain Lightning payment) — see
 * {@link SwapObservations}.
 */
export type TrackedSwap = {
  swapId: string;
  clientHtlc?: HtlcRef;
  serverHtlc?: HtlcRef;
  clientRefundLocktime: number;
  serverRefundLocktime: number;
};

export type ActionSubscriber = (swapId: string, actions: SwapActions) => void;

export type SwapTrackerOptions = {
  /**
   * How often (ms) to re-poll every manager to advance clocks and reconcile
   * observations. Needed because some ledgers (Arkade) have no event push, so
   * state only moves on a poll. `0` disables the timer (tests drive `refresh`).
   */
  refreshIntervalMs?: number;
};

export class SwapTracker {
  readonly #managers: Map<Ledger, ContractManager>;
  readonly #swaps = new Map<string, TrackedSwap>();
  /** Last actions emitted per swap — for dedupe and the subscribe-time snapshot. */
  readonly #lastActions = new Map<string, SwapActions>();
  readonly #subscribers = new Set<ActionSubscriber>();
  readonly #refreshIntervalMs: number;
  #eventUnsubs: Array<() => void> = [];
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    managers: Map<Ledger, ContractManager>,
    options?: SwapTrackerOptions,
  ) {
    this.#managers = managers;
    this.#refreshIntervalMs = options?.refreshIntervalMs ?? 0;
  }

  /**
   * Whether every on-chain leg of `swap` is observable — i.e. the tracker can
   * derive its status from chain. `false` means a leg is on a ledger/chain this
   * client can't reach (no manager, or an EVM chain with no RPC), so the swap
   * can't be tracked. Pure predicate — callers decide the policy (skip vs reject).
   */
  canObserve(swap: TrackedSwap): boolean {
    return legsOf(swap).every(
      (leg) => this.#managers.get(leg.ledger)?.canObserve(leg) ?? false,
    );
  }

  /** Register each swap's on-chain leg(s), subscribe to manager events, and seed state. */
  async startTracking(swaps: TrackedSwap[]): Promise<void> {
    for (const swap of swaps) {
      // Skip a swap with an unreachable leg rather than letting register() throw
      // and abort tracking for every other swap too. It simply goes untracked.
      if (!this.canObserve(swap)) {
        console.warn(
          `SwapTracker: skipping swap ${swap.swapId} — a leg is on a chain this client can't reach (configure it to track this swap)`,
        );
        continue;
      }
      this.#swaps.set(swap.swapId, swap);
      for (const leg of legsOf(swap)) await this.#managerFor(leg).register(leg);
    }
    for (const manager of new Set(this.#managers.values())) {
      this.#eventUnsubs.push(manager.onEvent(() => this.#recomputeAll()));
    }
    // Prime each manager: seeds its clock and does a full reconcile, so the first
    // recompute has both observations AND clocks. Without this a ledger whose
    // clock is only populated on refresh (Arkade's MTP) stays `undefined` and the
    // recompute bails forever — nothing is ever emitted.
    await this.#refreshManagers();
    this.#recomputeAll();
    // Poll onward: Arkade has no event push, and clocks advance with wall time.
    if (this.#refreshIntervalMs > 0)
      this.#timer = setInterval(
        () => void this.#tick(),
        this.#refreshIntervalMs,
      );
  }

  /**
   * Track one more swap after {@link startTracking} — register its on-chain
   * leg(s), seed the managers they touch, and derive its first action. Idempotent:
   * a swap already tracked, or one already seen through to a terminal action, is
   * ignored. New swaps are picked up by the existing per-manager event listeners
   * and poll timer, so nothing else needs re-wiring. Lets a swap created after
   * start (e.g. via `createSwap`) be tracked without a restart.
   */
  async track(swap: TrackedSwap): Promise<void> {
    // Already active, or already completed (lastActions is retained past
    // terminal) — either way, don't re-register.
    if (this.#swaps.has(swap.swapId) || this.#lastActions.has(swap.swapId))
      return;
    // Unreachable leg: skip rather than throw. (The create path rejects such a
    // swap up front; a pre-existing one reaching here just goes untracked.)
    if (!this.canObserve(swap)) {
      console.warn(
        `SwapTracker: skipping swap ${swap.swapId} — a leg is on a chain this client can't reach (configure it to track this swap)`,
      );
      return;
    }
    this.#swaps.set(swap.swapId, swap);

    const registered: HtlcRef[] = [];
    try {
      for (const leg of legsOf(swap)) {
        await this.#managerFor(leg).register(leg);
        registered.push(leg);
      }
    } catch (error) {
      // Roll back a partial registration. Without this the swap stays latched in
      // `#swaps` — so the guard above rejects every later retry — with one leg
      // watched and the other not, deriving nothing until a full stop/start.
      // A register failure is not self-healing (the poll can't set up a watch it
      // never made), so undo it and let a later sync try again cleanly.
      this.#swaps.delete(swap.swapId);
      for (const leg of registered) void this.#managerFor(leg).unregister(leg);
      throw error;
    }

    // Seed/advance just the managers this swap touches (clock + observations),
    // then derive its first action — mirrors startTracking's prime step. Unlike
    // registration, a failure here IS self-healing: the swap is fully registered,
    // so the poll tick retries the refresh and recomputes. Leave it tracked.
    const managers = new Set(legsOf(swap).map((leg) => this.#managerFor(leg)));
    await Promise.all([...managers].map((manager) => manager.refresh()));
    this.#recompute(swap);
  }

  async #tick(): Promise<void> {
    await this.#refreshManagers();
    this.#recomputeAll();
  }

  /**
   * Re-poll the managers that have a registered leg — seeding/advancing their
   * clocks and reconciling observations. Managers with nothing tracked are
   * skipped: refreshing them still hits their clock source (e.g. Arkade/Bitcoin
   * MTP via the API), so a swap that doesn't touch a ledger can't fail on that
   * ledger's endpoint being down (the default client builds every manager).
   */
  async #refreshManagers(): Promise<void> {
    const active = new Set<Ledger>();
    for (const swap of this.#swaps.values())
      for (const leg of legsOf(swap)) active.add(leg.ledger);
    const managers = new Set(
      [...active]
        .map((ledger) => this.#managers.get(ledger))
        .filter((m): m is ContractManager => m !== undefined),
    );
    await Promise.all([...managers].map((manager) => manager.refresh()));
  }

  /** The swap ids currently tracked — e.g. to subscribe them to a hint feed. */
  trackedSwapIds(): string[] {
    return [...this.#swaps.keys()];
  }

  /**
   * Re-verify one swap against the chain right now — the hook a faster server
   * status hint drives. Reconciles just that swap's legs (targeted, on the
   * managers), then recomputes its action. The hint is only a *trigger*: the
   * chain stays the source of truth, so a premature hint that the chain doesn't
   * yet reflect changes nothing. A no-op for an untracked swap.
   */
  async applyHint(swapId: string): Promise<void> {
    const swap = this.#swaps.get(swapId);
    if (!swap) return;
    await Promise.all(
      legsOf(swap).map((leg) => this.#managerFor(leg).reconcile(leg)),
    );
    this.#recompute(swap);
  }

  /** Notify `cb` of the current action for each tracked swap, then on every change. */
  subscribeToActions(cb: ActionSubscriber): () => void {
    this.#subscribers.add(cb);
    for (const [swapId, actions] of this.#lastActions) cb(swapId, actions);
    return () => this.#subscribers.delete(cb);
  }

  /**
   * Stop tracking: unregister every still-tracked leg (releasing its manager's
   * watch — e.g. the EVM per-chain block watch that only `unregister` tears down),
   * drop the poll timer, and detach event listeners + subscribers. Mirrors
   * `startTracking`'s `register`, so no manager keeps watching a stopped tracker's
   * swaps. The managers themselves are not owned here, so they are unregistered but
   * never disposed.
   */
  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    for (const unsub of this.#eventUnsubs) unsub();
    this.#eventUnsubs = [];
    for (const swap of this.#swaps.values())
      for (const leg of legsOf(swap))
        void this.#managerFor(leg).unregister(leg);
    this.#swaps.clear();
    this.#subscribers.clear();
  }

  #managerFor(ref: HtlcRef): ContractManager {
    const manager = this.#managers.get(ref.ledger);
    if (!manager)
      throw new Error(`no ContractManager for ledger '${ref.ledger}'`);
    return manager;
  }

  #recomputeAll(): void {
    for (const swap of this.#swaps.values()) this.#recompute(swap);
  }

  #recompute(swap: TrackedSwap): void {
    // A Lightning swap has one on-chain leg; the absent leg stays `undefined` (its
    // status is derived from the leg that exists). Gate only on present legs — a
    // leg with no observation or clock yet means "not enough known", so bail.
    let clientHtlc: HtlcObservation | undefined;
    let serverHtlc: HtlcObservation | undefined;
    let clientChainNow = 0;
    let serverChainNow = 0;

    if (swap.clientHtlc) {
      const m = this.#managerFor(swap.clientHtlc);
      clientHtlc = m.getState(swap.clientHtlc);
      const now = m.chainNow(swap.clientHtlc);
      if (clientHtlc === undefined || now === undefined) return;
      clientChainNow = now;
    }
    if (swap.serverHtlc) {
      const m = this.#managerFor(swap.serverHtlc);
      serverHtlc = m.getState(swap.serverHtlc);
      const now = m.chainNow(swap.serverHtlc);
      if (serverHtlc === undefined || now === undefined) return;
      serverChainNow = now;
    }

    const status = deriveSwapStatus({ clientHtlc, serverHtlc });
    if (status === undefined) return; // contradictory observations

    const actions = deriveSwapActions({
      status,
      clientChainNow,
      serverChainNow,
      clientRefundLocktime: swap.clientRefundLocktime,
      serverRefundLocktime: swap.serverRefundLocktime,
      // Pay-on-Lightning swaps have no client-funded on-chain leg.
      clientFunds: swap.clientHtlc !== undefined,
    });

    const previous = this.#lastActions.get(swap.swapId);
    if (previous && JSON.stringify(previous) === JSON.stringify(actions))
      return;

    this.#lastActions.set(swap.swapId, actions);
    for (const cb of this.#subscribers) cb(swap.swapId, actions);

    // Terminal: stop watching (retain lastActions so late subscribers still see it).
    if (actions.recommended === "none") this.#untrack(swap);
  }

  #untrack(swap: TrackedSwap): void {
    this.#swaps.delete(swap.swapId);
    for (const leg of legsOf(swap)) void this.#managerFor(leg).unregister(leg);
  }
}

/** The on-chain legs actually present on a swap (one for Lightning, two otherwise). */
function legsOf(swap: TrackedSwap): HtlcRef[] {
  const legs: HtlcRef[] = [];
  if (swap.clientHtlc) legs.push(swap.clientHtlc);
  if (swap.serverHtlc) legs.push(swap.serverHtlc);
  return legs;
}
