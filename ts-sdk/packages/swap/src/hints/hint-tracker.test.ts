import type { SwapStatus } from "@lendasat/lendaswap-sdk-pure";
import { describe, expect, it, vi } from "vitest";
import type { SwapActions } from "../actions/types.js";
import type { HtlcRef } from "../contracts/types.js";
import type { TrackedSwap } from "../tracker/swap-tracker.js";
import { HintTracker } from "./hint-tracker.js";

const clientLeg: HtlcRef = {
  ledger: "bitcoin",
  address: "bc1qclient",
  preimageHash: "ab".repeat(32),
  expectedSats: 1000,
};

/** A chain↔chain swap with generous locktimes (nothing expires mid-test). */
const swap = (overrides?: Partial<TrackedSwap>): TrackedSwap => ({
  swapId: "swap-1",
  clientHtlc: clientLeg,
  serverHtlc: { ...clientLeg, address: "bc1qserver" },
  clientRefundLocktime: Date.now() + 60 * 60 * 1000,
  serverRefundLocktime: Date.now() + 30 * 60 * 1000,
  ...overrides,
});

const collect = (tracker: HintTracker) => {
  const emitted: Array<{ swapId: string; actions: SwapActions }> = [];
  tracker.subscribeToActions((swapId, actions) =>
    emitted.push({ swapId, actions }),
  );
  return emitted;
};

describe("HintTracker", () => {
  it("derives the first action from the stored status, no fetch", async () => {
    const fetchStatus = vi.fn<(id: string) => Promise<SwapStatus>>();
    const tracker = new HintTracker({ fetchStatus, refreshIntervalMs: 0 });
    const emitted = collect(tracker);

    await tracker.startTracking([swap({ storedStatus: "clientfunded" })]);

    expect(fetchStatus).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.actions.recommended).toBe("wait");
  });

  it("emits nothing for a swap with no status yet", async () => {
    const tracker = new HintTracker({
      fetchStatus: vi.fn(),
      refreshIntervalMs: 0,
    });
    const emitted = collect(tracker);
    await tracker.startTracking([swap()]);
    expect(emitted).toHaveLength(0);
    expect(tracker.trackedSwapIds()).toEqual(["swap-1"]);
  });

  it("applies a pushed status directly (hint fast path)", async () => {
    const fetchStatus = vi.fn<(id: string) => Promise<SwapStatus>>();
    const tracker = new HintTracker({ fetchStatus, refreshIntervalMs: 0 });
    const emitted = collect(tracker);
    await tracker.startTracking([swap()]);

    await tracker.applyHint("swap-1", { status: "serverfunded" });

    expect(fetchStatus).not.toHaveBeenCalled();
    expect(emitted.at(-1)?.actions.recommended).toBe("claim");
  });

  it("falls back to fetchStatus when the hint carries no status", async () => {
    const fetchStatus = vi.fn(async (): Promise<SwapStatus> => "serverfunded");
    const tracker = new HintTracker({ fetchStatus, refreshIntervalMs: 0 });
    const emitted = collect(tracker);
    await tracker.startTracking([swap()]);

    await tracker.applyHint("swap-1");

    expect(fetchStatus).toHaveBeenCalledWith("swap-1");
    expect(emitted.at(-1)?.actions.recommended).toBe("claim");
  });

  it("dedupes unchanged derivations, re-emits on force", async () => {
    const tracker = new HintTracker({
      fetchStatus: vi.fn(),
      refreshIntervalMs: 0,
    });
    const emitted = collect(tracker);
    await tracker.startTracking([swap({ storedStatus: "clientfunded" })]);
    expect(emitted).toHaveLength(1);

    await tracker.applyHint("swap-1", { status: "clientfunded" });
    expect(emitted).toHaveLength(1); // unchanged → deduped

    await tracker.applyHint("swap-1", { status: "clientfunded", force: true });
    expect(emitted).toHaveLength(2);
  });

  it("untracks a swap on a terminal status, retains the snapshot", async () => {
    const tracker = new HintTracker({
      fetchStatus: vi.fn(),
      refreshIntervalMs: 0,
    });
    const emitted = collect(tracker);
    await tracker.startTracking([swap({ storedStatus: "clientfunded" })]);

    await tracker.applyHint("swap-1", { status: "serverredeemed" });

    expect(emitted.at(-1)?.actions.recommended).toBe("none");
    expect(tracker.trackedSwapIds()).toEqual([]);
    // A late subscriber still sees the terminal action.
    const late: string[] = [];
    tracker.subscribeToActions((swapId) => late.push(swapId));
    expect(late).toEqual(["swap-1"]);
    // And the swap is not re-admitted (already seen through to terminal).
    await tracker.track(swap({ storedStatus: "clientfunded" }));
    expect(tracker.trackedSwapIds()).toEqual([]);
  });

  it("pay-on-Lightning (no client leg) derives with clientFunds=false", async () => {
    const tracker = new HintTracker({
      fetchStatus: vi.fn(),
      refreshIntervalMs: 0,
    });
    const emitted = collect(tracker);
    await tracker.startTracking([
      swap({
        clientHtlc: undefined,
        clientRefundLocktime: 0,
        storedStatus: "pending",
      }),
    ]);

    const actions = emitted[0]?.actions;
    expect(actions?.recommended).toBe("wait");
    const wait = actions?.actions.find((a) => a.id === "wait");
    expect(wait && "waitingOn" in wait ? wait.waitingOn : undefined).toBe(
      "client_payment",
    );
  });

  it("timelock flips surface on recompute without a new hint", async () => {
    vi.useFakeTimers();
    try {
      const tracker = new HintTracker({
        fetchStatus: vi.fn(),
        refreshIntervalMs: 1_000,
      });
      const emitted = collect(tracker);
      await tracker.startTracking([
        swap({
          storedStatus: "clientfunded",
          clientRefundLocktime: Date.now() + 5_000,
        }),
      ]);
      expect(emitted.at(-1)?.actions.recommended).toBe("wait");

      vi.advanceTimersByTime(10_000);

      expect(emitted.at(-1)?.actions.recommended).toBe("refund_unilateral");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a hint for an untracked swap", async () => {
    const fetchStatus = vi.fn();
    const tracker = new HintTracker({ fetchStatus, refreshIntervalMs: 0 });
    await tracker.startTracking([]);
    await tracker.applyHint("nope", { status: "serverfunded" });
    expect(fetchStatus).not.toHaveBeenCalled();
  });
});
