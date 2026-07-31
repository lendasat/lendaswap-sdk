import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HtlcObservation } from "../actions/types.js";
import type { EvmHtlcEvent } from "./evm.js";
import {
  type EvmActiveQuery,
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
  /** Events served for every queried HTLC (the log path). */
  events: EvmHtlcEvent[] = [];
  /** htlcQueryKey → open? Missing key reads as inactive. */
  active = new Map<string, boolean>();
  blockTimeMs = 1_000;
  blockNumber = 100n;
  getHtlcEventsBatch = vi.fn(
    async (queries: EvmHtlcQuery[], _fromBlock?: bigint) => {
      return new Map(queries.map((q) => [htlcQueryKey(q), this.events]));
    },
  );
  isActiveBatch = vi.fn(async (queries: EvmActiveQuery[]) => {
    return new Map(
      queries.map((q) => [
        htlcQueryKey(q),
        this.active.get(htlcQueryKey(q)) ?? false,
      ]),
    );
  });
  getLatestBlock = async () => ({
    timeMs: this.blockTimeMs,
    number: this.blockNumber,
  });
}

describe("EvmContractManager", () => {
  let reader: FakeReader;
  let readers: Map<number, EvmChainReader>;

  beforeEach(() => {
    reader = new FakeReader();
    readers = new Map([[137, reader]]);
  });

  const build = () => EvmContractManager.fromDeps({ readers });

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

  it("register makes no RPC calls; the first refresh seeds observation and clock", async () => {
    const m = build();
    reader.events = [{ kind: "created", amount: 1000n, token: "0xwbtc" }];
    await m.register(ref);
    // Registration is passive — a startup burst of registers must not fan out
    // into per-swap chain scans. The tracker always follows with refresh().
    expect(reader.getHtlcEventsBatch).not.toHaveBeenCalled();
    expect(reader.isActiveBatch).not.toHaveBeenCalled();
    expect(m.getState(ref)).toBeUndefined();

    await m.refresh();
    expect(m.getState(ref)).toBe("confirmed");
    expect(m.chainNow(ref)).toBeGreaterThanOrEqual(1_000);
    expect(reader.getHtlcEventsBatch).toHaveBeenCalledWith(
      [{ htlc: "0xhtlc", preimageHash: "0xph", claimAddress: "0xclaim" }],
      0n,
    );
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
    await m.refresh();
    expect(m.getState(ref)).toBe("invalid");
  });

  it("re-observes and notifies on refresh", async () => {
    const m = build();
    const seen: HtlcObservation[] = [];
    m.onEvent((_r, s) => seen.push(s));
    reader.events = [{ kind: "created", amount: 1000n, token: "0xwbtc" }];
    await m.register(ref);
    await m.refresh();
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
    await m.refresh();
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
    await m.refresh();
    expect(m.chainNow(ref) ?? 0).toBeLessThan(m.chainNow(ethRef) ?? 0);
  });

  it("clears a chain's state once its last HTLC is unregistered", async () => {
    const m = build();
    await m.register(ref);
    await m.unregister(ref);
    expect(m.getState(ref)).toBeUndefined();
    expect(m.chainNow(ref)).toBeUndefined();
  });

  describe("isActive fast path (complete tuple)", () => {
    // A ref whose response exposed the whole contract tuple.
    const tupleRef = {
      ...ref,
      sender: "0xsender",
      timelockSec: 1_700_000_000,
      createdAtMs: 500,
    } satisfies HtlcRef;

    it("confirms an active HTLC without any log scan", async () => {
      const m = build();
      reader.active.set(htlcQueryKey(tupleRef), true);
      await m.register(tupleRef);
      await m.refresh();
      expect(m.getState(tupleRef)).toBe("confirmed");
      // isActive == true proves the terms — no logs needed at all.
      expect(reader.getHtlcEventsBatch).not.toHaveBeenCalled();
    });

    it("classifies an inactive HTLC from logs", async () => {
      const m = build();
      reader.events = [
        { kind: "created", amount: 1000n, token: "0xwbtc" },
        { kind: "refunded" },
      ];
      await m.register(tupleRef); // active-map empty → inactive
      await m.refresh();
      expect(reader.getHtlcEventsBatch).toHaveBeenCalledTimes(1);
      expect(m.getState(tupleRef)).toBe("spent_refund");
    });

    it("falls back to logs when the isActive check fails (no Multicall on chain)", async () => {
      const m = build();
      reader.isActiveBatch.mockRejectedValueOnce(new Error("no multicall"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      reader.events = [{ kind: "created", amount: 1000n, token: "0xwbtc" }];
      await m.register(tupleRef);
      await m.refresh();
      expect(m.getState(tupleRef)).toBe("confirmed");
      warn.mockRestore();
    });

    it("stops scanning a leg once it is latched on a spend", async () => {
      const m = build();
      reader.events = [
        { kind: "created", amount: 1000n, token: "0xwbtc" },
        { kind: "refunded" },
      ];
      await m.register(tupleRef);
      await m.refresh();
      expect(m.getState(tupleRef)).toBe("spent_refund");

      reader.isActiveBatch.mockClear();
      reader.getHtlcEventsBatch.mockClear();
      await m.refresh();
      // Terminal per leg: nothing left to learn, no requests at all.
      expect(reader.isActiveBatch).not.toHaveBeenCalled();
      expect(reader.getHtlcEventsBatch).not.toHaveBeenCalled();
    });
  });

  describe("with fake time", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("a targeted reconcile hits the chain immediately", async () => {
      const m = build();
      await m.register(ref);
      reader.getHtlcEventsBatch.mockClear();

      await m.reconcile(ref); // hint / at-risk path
      await m.reconcile(ref);
      expect(reader.getHtlcEventsBatch).toHaveBeenCalledTimes(2);
    });

    it("extrapolates chainNow between reads", async () => {
      const m = build();
      await m.register(ref);
      await m.refresh();
      const at0 = m.chainNow(ref);
      vi.advanceTimersByTime(30_000);
      // No RPC in between — the clock still advances with wall time.
      expect(m.chainNow(ref)).toBe((at0 ?? 0) + 30_000);
    });
  });
});
