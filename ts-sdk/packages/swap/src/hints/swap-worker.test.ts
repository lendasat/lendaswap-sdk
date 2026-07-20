import { describe, expect, it, vi } from "vitest";
import type {
  SwapActionAutomation,
  SwapActionId,
  SwapActions,
} from "../actions/types.js";
import {
  SwapWorker,
  type WorkerHintSource,
  type WorkerTracker,
} from "./swap-worker.js";

class FakeTracker implements WorkerTracker {
  ids: string[] = [];
  applied: string[] = [];
  #cb: ((id: string, a: SwapActions) => void) | undefined;
  trackedSwapIds(): string[] {
    return this.ids;
  }
  applyHint = async (id: string): Promise<void> => {
    this.applied.push(id);
  };
  subscribeToActions(cb: (id: string, a: SwapActions) => void): () => void {
    this.#cb = cb;
    return () => {
      this.#cb = undefined;
    };
  }
  emit(id: string, actions: SwapActions): void {
    this.#cb?.(id, actions);
  }
}

class FakeHintSource implements WorkerHintSource {
  started = false;
  stopped = false;
  subscribed: string[] = [];
  unsubscribed: string[] = [];
  #cb: ((u: { swapId: string }) => void) | undefined;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  subscribe(ids: string[]): void {
    this.subscribed.push(...ids);
  }
  unsubscribe(ids: string[]): void {
    this.unsubscribed.push(...ids);
  }
  onStatus(cb: (u: { swapId: string }) => void): () => void {
    this.#cb = cb;
    return () => {
      this.#cb = undefined;
    };
  }
  hint(swapId: string): void {
    this.#cb?.({ swapId });
  }
}

/** Automation per action id — mirrors what `deriveSwapActions` assigns. */
const AUTOMATION: Record<SwapActionId, SwapActionAutomation> = {
  wait: "auto",
  fund: "manual",
  claim: "auto",
  refund_collaborative: "confirm",
  refund_unilateral: "confirm",
  recover_cctp_claim: "confirm",
  none: "auto",
};

/** A `SwapActions` whose recommended action carries its real automation. */
const acts = (recommended?: SwapActionId): SwapActions =>
  (recommended === undefined
    ? { recommended, actions: [] }
    : {
        recommended,
        actions: [
          {
            id: recommended,
            recommended: true,
            automation: AUTOMATION[recommended],
            reason: "",
          },
        ],
      }) as SwapActions;

function setup(execute = vi.fn(async () => {})) {
  const tracker = new FakeTracker();
  const hintSource = new FakeHintSource();
  const onActionRequired = vi.fn();
  const worker = new SwapWorker({
    tracker,
    hintSource,
    execute,
    onActionRequired,
  });
  return { tracker, hintSource, worker, execute, onActionRequired };
}

describe("SwapWorker", () => {
  it("subscribes the tracked swaps to the hint feed and starts it", () => {
    const { tracker, hintSource, worker } = setup();
    tracker.ids = ["a", "b"];
    worker.start();
    expect(hintSource.subscribed).toEqual(["a", "b"]);
    expect(hintSource.started).toBe(true);
  });

  it("verifies against the chain on a hint (applyHint)", () => {
    const { tracker, hintSource, worker } = setup();
    worker.start();
    hintSource.hint("s1");
    expect(tracker.applied).toEqual(["s1"]);
  });

  it("auto-executes a recommended claim", async () => {
    const { tracker, worker, execute } = setup();
    worker.start();
    tracker.emit("s1", acts("claim"));
    expect(execute).toHaveBeenCalledWith("s1", "claim");
  });

  it("surfaces a refund instead of running it", () => {
    const { tracker, worker, execute, onActionRequired } = setup();
    worker.start();
    const refund = acts("refund_unilateral");
    tracker.emit("s1", refund);
    expect(execute).not.toHaveBeenCalled();
    expect(onActionRequired).toHaveBeenCalledWith("s1", refund);
  });

  it("surfaces a manual fund instead of running it", () => {
    const { tracker, worker, execute, onActionRequired } = setup();
    worker.start();
    tracker.emit("s1", acts("fund"));
    expect(execute).not.toHaveBeenCalled();
    expect(onActionRequired).toHaveBeenCalledWith("s1", acts("fund"));
  });

  it("does not surface 'wait' — an auto no-op needs no user action", () => {
    const { tracker, worker, execute, onActionRequired } = setup();
    worker.start();
    tracker.emit("s1", acts("wait"));
    expect(execute).not.toHaveBeenCalled();
    expect(onActionRequired).not.toHaveBeenCalled();
  });

  it("does not double-run a claim while one is in flight", () => {
    let release!: () => void;
    const execute = vi.fn(() => new Promise<void>((r) => (release = r)));
    const { tracker, worker } = setup(execute);
    worker.start();
    tracker.emit("s1", acts("claim"));
    tracker.emit("s1", acts("claim")); // still in flight
    expect(execute).toHaveBeenCalledTimes(1);
    release();
  });

  it("unsubscribes a swap from the hint feed on a terminal action", () => {
    const { tracker, hintSource, worker } = setup();
    worker.start();
    tracker.emit("s1", acts("none"));
    expect(hintSource.unsubscribed).toContain("s1");
  });

  it("stop() detaches and closes the hint feed", () => {
    const { tracker, hintSource, worker, execute } = setup();
    worker.start();
    worker.stop();
    expect(hintSource.stopped).toBe(true);
    // No longer reacting after stop.
    tracker.emit("s1", acts("claim"));
    hintSource.hint("s1");
    expect(execute).not.toHaveBeenCalled();
    expect(tracker.applied).toEqual([]);
  });
});
