import {
  ConditionWitness,
  setArkPsbtField,
  Transaction,
  type VirtualCoin,
} from "@arkade-os/sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64, hex } from "@scure/base";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HtlcObservation } from "../actions/types.js";
import { ArkadeContractManager, type ArkadeIndexer } from "./arkade-manager.js";
import type { HtlcRef } from "./types.js";

const preimage = new Uint8Array(32).fill(7);
const paymentHash = sha256(preimage);

const ref = {
  ledger: "arkade",
  script: "deadbeef",
  address: "ark1qexample",
  preimageHash: hex.encode(paymentHash),
  expectedSats: 1000,
  params: { sender: "ab12", receiver: "cd34" },
} satisfies HtlcRef;

/** A base64 PSBT with one input, optionally carrying a ConditionWitness. */
function spendPsbt(secret?: Uint8Array): string {
  const tx = new Transaction({ allowUnknownInputs: true });
  tx.addInput({ txid: new Uint8Array(32).fill(1), index: 0 });
  if (secret) setArkPsbtField(tx, 0, ConditionWitness, [secret]);
  return base64.encode(tx.toPSBT());
}

/** Build a minimal vtxo; only the fields the observer reads matter. */
function vtxo(p: {
  state: "preconfirmed" | "settled" | "swept" | "spent";
  arkTxId?: string;
  spentBy?: string;
  value?: number;
}): VirtualCoin {
  return {
    virtualStatus: { state: p.state },
    isSpent: p.state === "spent",
    arkTxId: p.arkTxId,
    spentBy: p.spentBy,
    value: p.value ?? 1000,
  } as unknown as VirtualCoin;
}

class FakeIndexer implements ArkadeIndexer {
  vtxos: VirtualCoin[] = [];
  txs: string[] = [];
  getVtxos = vi.fn(async () => ({ vtxos: this.vtxos }));
  getVirtualTxs = vi.fn(async () => ({ txs: this.txs }));
}

describe("ArkadeContractManager", () => {
  let indexer: FakeIndexer;

  beforeEach(() => {
    indexer = new FakeIndexer();
  });

  const build = () => ArkadeContractManager.fromDeps({ indexer });

  it("rejects non-arkade HTLCs", async () => {
    await expect(
      build().register({ ledger: "lightning", paymentHash: "ab" }),
    ).rejects.toThrow(/can't track/);
  });

  it("is absent when the VHTLC has no vtxos", async () => {
    const m = build();
    await m.register(ref);
    // Registration is passive — a startup burst must not fan out into
    // per-swap indexer scans. The tracker always follows with refresh().
    expect(indexer.getVtxos).not.toHaveBeenCalled();
    await m.refresh();
    expect(indexer.getVtxos).toHaveBeenCalledWith({ scripts: [ref.script] });
    expect(m.getState(ref)).toBe("absent");
  });

  it("is confirmed once funded with the expected amount", async () => {
    const m = build();
    indexer.vtxos = [vtxo({ state: "settled", value: 1000 })];
    await m.register(ref);
    await m.refresh();
    expect(m.getState(ref)).toBe("confirmed");
  });

  it("is invalid when funded below the expected amount", async () => {
    const m = build();
    indexer.vtxos = [vtxo({ state: "settled", value: 999 })];
    await m.register(ref);
    await m.refresh();
    expect(m.getState(ref)).toBe("invalid");
  });

  it("classifies a claim spend (keyed on arkTxId) and recovers the verified preimage", async () => {
    const m = build();
    // The spend is exposed via `arkTxId` with `spentBy` empty — the case the old
    // `spentBy`-only read silently missed (leaving it stuck as `confirmed`).
    indexer.vtxos = [vtxo({ state: "spent", arkTxId: "spendtx" })];
    indexer.txs = [spendPsbt(preimage)];
    await m.register(ref);
    await m.refresh();
    expect(indexer.getVirtualTxs).toHaveBeenCalledWith(["spendtx"]);
    expect(m.getState(ref)).toBe("spent_claim");
    expect(m.getPreimage(ref)).toEqual(preimage);
  });

  it("classifies a timelock refund spend (no preimage revealed)", async () => {
    const m = build();
    indexer.vtxos = [vtxo({ state: "spent", arkTxId: "spendtx" })];
    indexer.txs = [spendPsbt()];
    await m.register(ref);
    await m.refresh();
    expect(m.getState(ref)).toBe("spent_refund");
    expect(m.getPreimage(ref)).toBeUndefined();
  });

  it("falls back to spentBy when arkTxId is absent", async () => {
    const m = build();
    indexer.vtxos = [vtxo({ state: "spent", spentBy: "spendtx" })];
    indexer.txs = [spendPsbt(preimage)];
    await m.register(ref);
    await m.refresh();
    expect(indexer.getVirtualTxs).toHaveBeenCalledWith(["spendtx"]);
    expect(m.getState(ref)).toBe("spent_claim");
  });

  it("notifies listeners and re-observes on refresh", async () => {
    const m = build();
    const seen: HtlcObservation[] = [];
    m.onEvent((_r, s) => seen.push(s));
    await m.register(ref);
    await m.refresh(); // absent

    indexer.vtxos = [vtxo({ state: "settled" })];
    await m.refresh();
    expect(m.getState(ref)).toBe("confirmed");
    expect(seen).toEqual(["absent", "confirmed"]);
  });

  it("never downgrades a resolved spend back to a funding state", async () => {
    const m = build();
    indexer.vtxos = [vtxo({ state: "spent", arkTxId: "spendtx" })];
    indexer.txs = [spendPsbt(preimage)];
    await m.register(ref);
    await m.refresh();
    expect(m.getState(ref)).toBe("spent_claim");
    // A later poll that only sees a funded vtxo must not revert the spend.
    indexer.vtxos = [vtxo({ state: "settled" })];
    await m.refresh();
    expect(m.getState(ref)).toBe("spent_claim");
  });

  it("reports chainNow only once a chain time is provided", async () => {
    const withClock = ArkadeContractManager.fromDeps({
      indexer,
      chainTime: async () => 1_700_000_000_000,
    });
    expect(withClock.chainNow(ref)).toBeUndefined();
    await withClock.refresh();
    expect(withClock.chainNow(ref)).toBe(1_700_000_000_000);
  });

  it("unregisters and forgets state", async () => {
    const m = build();
    indexer.vtxos = [vtxo({ state: "settled" })];
    await m.register(ref);
    await m.refresh();
    expect(m.getState(ref)).toBe("confirmed");
    await m.unregister(ref);
    expect(m.getState(ref)).toBeUndefined();
  });
});

describe("ArkadeContractManager push subscription", () => {
  /** A FakeIndexer with a controllable subscription event stream. */
  class PushIndexer extends FakeIndexer {
    #queue: { scripts: string[] }[] = [];
    #wake: (() => void) | undefined;
    ended = false;
    subscribeForScripts = vi.fn(
      async (_scripts: string[], id?: string) => id ?? "sub-1",
    );
    unsubscribeForScripts = vi.fn(async () => {});
    getSubscription = vi.fn((_id: string, signal: AbortSignal) =>
      this.#iterate(signal),
    );
    /** Emit a subscription event for the given scripts. */
    push(scripts: string[]): void {
      this.#queue.push({ scripts });
      this.#wake?.();
    }
    /** Terminate the current stream (simulates a dropped connection). */
    end(): void {
      this.ended = true;
      this.#wake?.();
    }
    async *#iterate(
      signal: AbortSignal,
    ): AsyncIterableIterator<{ scripts: string[] }> {
      while (!signal.aborted && !this.ended) {
        if (this.#queue.length === 0)
          await new Promise<void>((resolve) => {
            this.#wake = resolve;
          });
        const next = this.#queue.shift();
        if (next) yield next;
      }
    }
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("a subscription event triggers a targeted reconcile (no polling)", async () => {
    const indexer = new PushIndexer();
    const m = ArkadeContractManager.fromDeps({ indexer });
    await m.register(ref);
    expect(indexer.subscribeForScripts).toHaveBeenCalledWith(
      [ref.script],
      undefined,
    );
    await m.refresh();
    expect(m.getState(ref)).toBe("absent");

    indexer.vtxos = [vtxo({ state: "settled" })];
    indexer.push([ref.script]);
    await tick();
    await tick();
    expect(m.getState(ref)).toBe("confirmed");
    m.dispose();
  });

  it("gates the passive refresh while the stream is live; reconcile is never gated", async () => {
    const indexer = new PushIndexer();
    const m = ArkadeContractManager.fromDeps({
      indexer,
      fallbackScanIntervalMs: 60_000,
    });
    await m.register(ref);
    await m.refresh(); // first scan stamps the gate
    indexer.getVtxos.mockClear();

    await m.refresh(); // within the interval → no-op
    expect(indexer.getVtxos).not.toHaveBeenCalled();

    await m.reconcile(ref); // targeted verify — always hits the indexer
    expect(indexer.getVtxos).toHaveBeenCalledTimes(1);
    m.dispose();
  });

  it("a ref registered inside the gate interval is caught up without a full rescan", async () => {
    const indexer = new PushIndexer();
    const m = ArkadeContractManager.fromDeps({
      indexer,
      fallbackScanIntervalMs: 60_000,
    });
    await m.register(ref);
    await m.refresh(); // first scan stamps the gate
    const ref2 = { ...ref, script: "feedface" } satisfies HtlcRef;
    await m.register(ref2); // registration alone never scans
    indexer.getVtxos.mockClear();

    await m.refresh(); // gated, but ref2 has no observation yet
    expect(indexer.getVtxos).toHaveBeenCalledTimes(1);
    expect(indexer.getVtxos).toHaveBeenCalledWith({ scripts: [ref2.script] });
    expect(m.getState(ref2)).toBe("absent");
    m.dispose();
  });

  it("re-subscribes and catch-up scans after the stream drops", async () => {
    const indexer = new PushIndexer();
    const m = ArkadeContractManager.fromDeps({
      indexer,
      resubscribeDelayMs: 1,
    });
    await m.register(ref);
    indexer.getVtxos.mockClear();

    indexer.end(); // the long-lived stream dies
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Re-subscribed with the full tracked set, then caught up from a scan.
    expect(
      indexer.subscribeForScripts.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(indexer.getVtxos).toHaveBeenCalled();
    m.dispose();
  });

  it("keeps polling refresh ungated when the indexer cannot push", async () => {
    const indexer = new FakeIndexer(); // no subscription support
    const m = ArkadeContractManager.fromDeps({
      indexer,
      fallbackScanIntervalMs: 60_000,
    });
    await m.register(ref);
    await m.refresh();
    indexer.getVtxos.mockClear();
    await m.refresh(); // polling is the only signal — must not be gated
    expect(indexer.getVtxos).toHaveBeenCalledTimes(1);
  });
});
