/**
 * Ties the hint feed and the action model together into auto-execution.
 *
 * On a server status hint it verifies the swap against the chain
 * (`tracker.applyHint`) — the hint only makes the derivation faster, the chain
 * stays the source of truth. Then, on every derived action, it AUTO-RUNS the
 * recommended action when it is auto-safe (a claim) and SURFACES the rest — a
 * manual `fund`, or a refund the user must confirm — via `onActionRequired`, the
 * seam a frontend notification center plugs into.
 */
import type { SwapActionId, SwapActions } from "../actions/types.js";

/** The tracker surface the worker drives. */
export interface WorkerTracker {
  trackedSwapIds(): string[];
  applyHint(swapId: string): Promise<void>;
  subscribeToActions(
    cb: (swapId: string, actions: SwapActions) => void,
  ): () => void;
}

/** The hint feed surface the worker consumes (`WsStatusSource` satisfies it). */
export interface WorkerHintSource {
  start(): void;
  stop(): void;
  subscribe(swapIds: string[]): void;
  unsubscribe(swapIds: string[]): void;
  onStatus(cb: (update: { swapId: string }) => void): () => void;
}

export type SwapWorkerOptions = {
  tracker: WorkerTracker;
  hintSource: WorkerHintSource;
  /**
   * Run the recommended auto action for a swap (today: claim). Called at most once
   * per swap at a time; reject to signal failure (a later recompute retries),
   * resolve once submitted.
   */
  execute: (swapId: string, actionId: SwapActionId) => Promise<void>;
  /**
   * Surface an action that needs the user rather than being auto-run — a manual
   * `fund`, or a refund the user must confirm. Where a UI notification hooks in.
   */
  onActionRequired?: (swapId: string, actions: SwapActions) => void;
};

/** Actions the worker runs automatically. `wait`/`none` are auto but no-ops. */
const AUTO_EXECUTABLE: ReadonlySet<SwapActionId> = new Set<SwapActionId>([
  "claim",
]);

export class SwapWorker {
  readonly #tracker: WorkerTracker;
  readonly #hintSource: WorkerHintSource;
  readonly #execute: SwapWorkerOptions["execute"];
  readonly #onActionRequired: SwapWorkerOptions["onActionRequired"];

  /** Swaps with an auto action in flight — guards against double-runs. */
  readonly #executing = new Set<string>();
  #unsubs: Array<() => void> = [];
  #started = false;

  constructor(options: SwapWorkerOptions) {
    this.#tracker = options.tracker;
    this.#hintSource = options.hintSource;
    this.#execute = options.execute;
    this.#onActionRequired = options.onActionRequired;
  }

  /** Watch tracked swaps on the hint feed, wire hints → verify, react to actions. */
  start(): void {
    if (this.#started) return;
    this.#started = true;

    this.#hintSource.subscribe(this.#tracker.trackedSwapIds());
    this.#unsubs.push(
      this.#hintSource.onStatus(({ swapId }) => {
        void this.#tracker.applyHint(swapId).catch((error) => {
          console.warn(`SwapWorker: applyHint(${swapId}) failed:`, error);
        });
      }),
    );
    this.#hintSource.start();

    this.#unsubs.push(
      this.#tracker.subscribeToActions((swapId, actions) =>
        this.#onActions(swapId, actions),
      ),
    );
  }

  /** Stop reacting and close the hint feed. */
  stop(): void {
    this.#started = false;
    for (const unsub of this.#unsubs) unsub();
    this.#unsubs = [];
    this.#hintSource.stop();
    this.#executing.clear();
  }

  #onActions(swapId: string, actions: SwapActions): void {
    // Ensure the swap is on the hint feed (covers swaps whose first action only
    // appears after tracking started).
    this.#hintSource.subscribe([swapId]);

    const recommended = actions.recommended;
    if (recommended === "none") {
      this.#hintSource.unsubscribe([swapId]); // terminal — no more hints needed
      return;
    }
    if (recommended && AUTO_EXECUTABLE.has(recommended)) {
      this.#autoExecute(swapId, recommended);
      return;
    }
    if (recommended) this.#onActionRequired?.(swapId, actions);
  }

  #autoExecute(swapId: string, actionId: SwapActionId): void {
    if (this.#executing.has(swapId)) return; // one in-flight run per swap
    this.#executing.add(swapId);
    void this.#execute(swapId, actionId)
      .catch((error) => {
        console.warn(`SwapWorker: ${actionId}(${swapId}) failed:`, error);
      })
      .finally(() => this.#executing.delete(swapId));
  }
}
