import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HtlcObservation } from "../actions/types.js";
import type { EvmHtlcEvent } from "./evm.js";
import {
  type EvmChainReader,
  EvmContractManager,
  type EvmHtlcQuery,
  htlcQueryKey,
} from "./evm-manager.js";
import type { HtlcRef } from "./types.js";

const ref = {
  ledger: "evm",
  chainId: 137,
  htlc: "0xhtlc",
  preimageHash: "0xph",
  claimAddress: "0xclaim",
  expectedAmount: 1000n,
  expectedToken: "0xwbtc",
} satisfies HtlcRef;

class FakeReader implements EvmChainReader {
  /** Events served for every queried HTLC. */
  events: EvmHtlcEvent[] = [];
  blockTimeMs = 1_000;
  getHtlcEventsBatch = vi.fn(async (queries: EvmHtlcQuery[]) => {
    return new Map(queries.map((q) => [htlcQueryKey(q), this.events]));
  });
  getBlockTimeMs = async () => this.blockTimeMs;
}

describe("EvmContractManager", () => {
  let reader: FakeReader;
  let readers: Map<number, EvmChainReader>;

  beforeEach(() => {
    reader = new FakeReader();
    readers = new Map([[137, reader]]);
  });

  /** Passive-scan gate off by default in tests: every refresh() rescans. */
  const build = (fallbackScanIntervalMs = 0) =>
    EvmContractManager.fromDeps({ readers, fallbackScanIntervalMs });

  it("rejects non-evm HTLCs", async () => {
    await expect(
      build().register({ ledger: "lightning", paymentHash: "ab" }),
    ).rejects.toThrow(/can't track/);
  });

  it("throws for a chain with no configured reader (instead of silently stalling)", async () => {
    await expect(build().register({ ...ref, chainId: 8453 })).rejects.toThrow(
      /no EVM reader for chain 8453/,
    );
  });

  it("seeds the observation and the chain clock on register", async () => {
    const m = build();
    reader.events = [{ kind: "created", amount: 1000n, token: "0xwbtc" }];
    await m.register(ref);
    expect(m.getState(ref)).toBe("confirmed");
    expect(m.chainNow(ref)).toBeGreaterThanOrEqual(1_000);
    expect(reader.getHtlcEventsBatch).toHaveBeenCalledWith([
      { htlc: "0xhtlc", preimageHash: "0xph", claimAddress: "0xclaim" },
    ]);
  });

  it("reads a whole chain's HTLCs in one batched call", async () => {
    const m = build();
    const ref2 = { ...ref, preimageHash: "0xph2" } satisfies HtlcRef;
    await m.register(ref);
    await m.register(ref2);

    reader.getHtlcEventsBatch.mockClear();
    await m.refresh();

    expect(reader.getHtlcEventsBatch).toHaveBeenCalledTimes(1);
    const queries = reader.getHtlcEventsBatch.mock.calls[0][0];
    expect(queries.map((q) => q.preimageHash).sort()).toEqual([
      "0xph",
      "0xph2",
    ]);
  });

  it("is invalid when the HTLC is funded below the expected amount", async () => {
    const m = build();
    reader.events = [{ kind: "created", amount: 999n, token: "0xwbtc" }];
    await m.register(ref);
    expect(m.getState(ref)).toBe("invalid");
  });

  it("re-observes and notifies on refresh", async () => {
    const m = build();
    const seen: HtlcObservation[] = [];
    m.onEvent((_r, s) => seen.push(s));
    reader.events = [{ kind: "created", amount: 1000n, token: "0xwbtc" }];
    await m.register(ref);
    expect(m.getState(ref)).toBe("confirmed");

    reader.events = [
      { kind: "created", amount: 1000n, token: "0xwbtc" },
      { kind: "redeemed", preimage: "0xse" },
    ];
    await m.refresh();
    expect(m.getState(ref)).toBe("spent_claim");
    expect(m.getPreimage(ref)).toBe("0xse");
    expect(seen).toEqual(["confirmed", "spent_claim"]);
  });

  it("never downgrades a resolved spend", async () => {
    const m = build();
    reader.events = [
      { kind: "created", amount: 1000n, token: "0xwbtc" },
      { kind: "refunded" },
    ];
    await m.register(ref);
    expect(m.getState(ref)).toBe("spent_refund");
    // A stale read that no longer sees the refund must not revert it.
    reader.events = [{ kind: "created", amount: 1000n, token: "0xwbtc" }];
    await m.refresh();
    expect(m.getState(ref)).toBe("spent_refund");
  });

  it("tracks independent clocks per chain", async () => {
    const other = new FakeReader();
    other.blockTimeMs = 500_000;
    readers.set(1, other);
    const m = build();
    const ethRef = { ...ref, chainId: 1 } satisfies HtlcRef;
    await m.register(ref);
    await m.register(ethRef);
    expect(m.chainNow(ref) ?? 0).toBeLessThan(m.chainNow(ethRef) ?? 0);
  });

  it("clears a chain's state once its last HTLC is unregistered", async () => {
    const m = build();
    await m.register(ref);
    await m.unregister(ref);
    expect(m.getState(ref)).toBeUndefined();
    expect(m.chainNow(ref)).toBeUndefined();
  });

  describe("with fake time", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("rate-limits passive refresh scans to the fallback interval", async () => {
      const m = build(60_000);
      await m.register(ref); // scan #1 (register is never gated)
      reader.getHtlcEventsBatch.mockClear();

      await m.refresh(); // within the interval → no-op
      await m.refresh();
      expect(reader.getHtlcEventsBatch).not.toHaveBeenCalled();

      vi.advanceTimersByTime(61_000);
      await m.refresh(); // interval elapsed → scans
      expect(reader.getHtlcEventsBatch).toHaveBeenCalledTimes(1);
    });

    it("a targeted reconcile is never gated", async () => {
      const m = build(60_000);
      await m.register(ref);
      reader.getHtlcEventsBatch.mockClear();

      await m.reconcile(ref); // hint path — must hit the chain immediately
      await m.reconcile(ref);
      expect(reader.getHtlcEventsBatch).toHaveBeenCalledTimes(2);
    });

    it("extrapolates chainNow between scans", async () => {
      const m = build(60_000);
      await m.register(ref);
      const at0 = m.chainNow(ref);
      vi.advanceTimersByTime(30_000);
      // No RPC in between — the clock still advances with wall time.
      expect(m.chainNow(ref)).toBe((at0 ?? 0) + 30_000);
    });
  });
});
