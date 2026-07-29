import {
  Client as LegacyClient,
  type StoredSwap,
} from "@lendasat/lendaswap-sdk-pure";
import { describe, expect, it, vi } from "vitest";
import type { HtlcObservation } from "./actions/types.js";
import { Client } from "./client.js";
import {
  type ContractManager,
  type HtlcRef,
  htlcKey,
  type Ledger,
} from "./contracts/types.js";

/** A monitor that only records what it was asked to register. */
class FakeManager implements ContractManager {
  readonly ledger: Ledger;
  readonly registered = new Set<string>();
  constructor(ledger: Ledger) {
    this.ledger = ledger;
  }
  /** Flip to false to simulate an unreachable ledger/chain. */
  observable = true;
  canObserve = (_ref: HtlcRef): boolean => this.observable;
  register = async (ref: HtlcRef): Promise<void> => {
    this.registered.add(htlcKey(ref));
  };
  unregister = async (ref: HtlcRef): Promise<void> => {
    this.registered.delete(htlcKey(ref));
  };
  getState = (_ref: HtlcRef): HtlcObservation | undefined => undefined;
  chainNow = (_ref: HtlcRef): number | undefined => undefined;
  onEvent = (): (() => void) => () => {};
  refresh = async (): Promise<void> => {};
  reconcile = async (): Promise<void> => {};
  dispose = (): void => {};
}

/** A legacy-client stand-in that satisfies `instanceof` but returns canned swaps. */
function fakeLegacy(swaps: StoredSwap[]): LegacyClient {
  const legacy = Object.create(LegacyClient.prototype) as LegacyClient;
  Object.assign(legacy, { listAllSwaps: async () => swaps });
  return legacy;
}

function managers() {
  const arkade = new FakeManager("arkade");
  const evm = new FakeManager("evm");
  return {
    arkade,
    evm,
    map: new Map<Ledger, ContractManager>([
      ["arkade", arkade],
      ["evm", evm],
    ]),
  };
}

// A valid arkade_to_evm swap (BIP340 pubkeys; delays are multiples of 512).
const arkadeEvmSwap = {
  response: {
    direction: "arkade_to_evm",
    id: "swap-1",
    sender_pk:
      "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    receiver_pk:
      "dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659",
    arkade_server_pk:
      "dd308afec5777e13121fa72b9cc1b7cc0139715309b086c960e18fd969774eb8",
    hash_lock:
      "abababababababababababababababababababababababababababababababab",
    btc_vhtlc_address: "ark1qexample",
    vhtlc_refund_locktime: 1_000_000,
    evm_refund_locktime: 900_000,
    evm_chain_id: 137,
    evm_htlc_address: "0xhtlc",
    evm_expected_sats: "1000",
    client_evm_address: "0xclient",
    server_evm_address: "0xserver",
    wbtc_address: "0xwbtc",
    source_amount: "1000",
    unilateral_claim_delay: 512,
    unilateral_refund_delay: 1024,
    unilateral_refund_without_receiver_delay: 1536,
  },
} as unknown as StoredSwap;

const unsupportedSwap = {
  response: { direction: "future_direction", id: "swap-2" },
} as unknown as StoredSwap;

/** Tracking config with an explicit managers override (skips auto-construction). */
const withManagers = (map: Map<Ledger, ContractManager>) => ({
  enabled: true,
  managers: map,
  refreshIntervalMs: 0, // no timer in tests
});

describe("Client tracking", () => {
  it("rejects startTracking when tracking is disabled", () => {
    const client = new Client(fakeLegacy([]), { enabled: false });
    return expect(client.startTracking()).rejects.toThrow(/disabled/);
  });

  it("requires startTracking before subscribeToActions", () => {
    const m = managers();
    const client = new Client(fakeLegacy([]), withManagers(m.map));
    expect(() => client.subscribeToActions(() => {})).toThrow(/startTracking/);
  });

  it("registers both legs of a supported swap", async () => {
    const m = managers();
    const client = new Client(fakeLegacy([arkadeEvmSwap]), withManagers(m.map));
    await client.startTracking();
    expect(m.arkade.registered.size).toBe(1);
    expect(m.evm.registered.size).toBe(1);
  });

  it("does not register a swap the server already settled (stored-status filter)", async () => {
    const m = managers();
    const settled = {
      response: {
        ...(arkadeEvmSwap as { response: object }).response,
        status: "serverredeemed",
      },
    } as unknown as StoredSwap;
    const client = new Client(fakeLegacy([settled]), withManagers(m.map));
    await client.startTracking();
    expect(m.arkade.registered.size).toBe(0);
    expect(m.evm.registered.size).toBe(0);
  });

  it("skips swaps whose ledgers aren't observable yet", async () => {
    const m = managers();
    const client = new Client(
      fakeLegacy([unsupportedSwap]),
      withManagers(m.map),
    );
    await client.startTracking();
    expect(m.arkade.registered.size).toBe(0);
    expect(m.evm.registered.size).toBe(0);
  });

  it("is idempotent — a second startTracking doesn't re-register", async () => {
    const m = managers();
    const client = new Client(fakeLegacy([arkadeEvmSwap]), withManagers(m.map));
    await client.startTracking();
    await client.startTracking();
    expect(m.arkade.registered.size).toBe(1);
  });

  it("subscribeToActions returns an unsubscribe and stopTracking is safe", async () => {
    const m = managers();
    const client = new Client(fakeLegacy([]), withManagers(m.map));
    await client.startTracking();
    const unsub = client.subscribeToActions(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
    expect(() => client.stopTracking()).not.toThrow();
  });

  it("unregisters every tracked leg on stopTracking (no leaked manager watches)", async () => {
    const m = managers();
    const client = new Client(fakeLegacy([arkadeEvmSwap]), withManagers(m.map));
    await client.startTracking();
    expect(m.arkade.registered.size).toBe(1);
    expect(m.evm.registered.size).toBe(1);
    client.stopTracking();
    // Both legs released, so the managers stop watching this swap.
    expect(m.arkade.registered.size).toBe(0);
    expect(m.evm.registered.size).toBe(0);
  });

  it("tracks a swap created after startTracking (track-on-create)", async () => {
    const m = managers();
    // A legacy stand-in whose create persists to storage, as the real one does.
    const swaps: StoredSwap[] = [];
    const legacy = Object.create(LegacyClient.prototype) as LegacyClient;
    Object.assign(legacy, {
      listAllSwaps: async () => swaps,
      createArkadeToEvmSwapGeneric: async () => {
        swaps.push(arkadeEvmSwap);
        return { response: { id: "swap-1" } };
      },
    });
    const client = new Client(legacy, withManagers(m.map));
    await client.startTracking();
    expect(m.arkade.registered.size).toBe(0); // nothing created yet

    await client.createArkadeToEvmSwapGeneric(
      {} as Parameters<Client["createArkadeToEvmSwapGeneric"]>[0],
    );

    // Tracking-sync is fire-and-forget (never blocks the create), so wait for it.
    await vi.waitFor(() => {
      expect(m.arkade.registered.size).toBe(1);
      expect(m.evm.registered.size).toBe(1);
    });
  });

  it("rejects creating a swap with an unreachable leg (throw-on-create)", async () => {
    const m = managers();
    m.evm.observable = false; // the created swap's EVM chain has no reader
    const swaps: StoredSwap[] = [];
    const legacy = Object.create(LegacyClient.prototype) as LegacyClient;
    Object.assign(legacy, {
      listAllSwaps: async () => swaps,
      createArkadeToEvmSwapGeneric: async () => {
        swaps.push(arkadeEvmSwap);
        return { response: { id: "swap-1" } };
      },
    });
    const client = new Client(legacy, withManagers(m.map));
    await client.startTracking();

    await expect(
      client.createArkadeToEvmSwapGeneric(
        {} as Parameters<Client["createArkadeToEvmSwapGeneric"]>[0],
      ),
    ).rejects.toThrow(/can't reach/);
    // Not tracked — it was rejected, not folded in.
    expect(m.arkade.registered.size).toBe(0);
  });

  it("tracks the replacement swap after a retry (track-on-retry)", async () => {
    const m = managers();
    const swaps: StoredSwap[] = [];
    const legacy = Object.create(LegacyClient.prototype) as LegacyClient;
    Object.assign(legacy, {
      listAllSwaps: async () => swaps,
      // The real retry creates + persists a replacement swap internally.
      retryArkadeToLightningSwap: async () => {
        swaps.push(arkadeEvmSwap);
        return {
          newSwap: { id: "swap-1" },
          refundTxId: "tx",
          refundAmount: 1n,
        };
      },
    });
    const client = new Client(legacy, withManagers(m.map));
    await client.startTracking();
    expect(m.arkade.registered.size).toBe(0);

    await client.retryArkadeToLightningSwap("old-swap", {
      lightningAddress: "user@example.com",
    });

    await vi.waitFor(() => {
      expect(m.arkade.registered.size).toBe(1);
      expect(m.evm.registered.size).toBe(1);
    });
  });

  it("does not reject a retry over an unreachable leg (funds already moved)", async () => {
    const m = managers();
    m.evm.observable = false;
    const swaps: StoredSwap[] = [];
    const legacy = Object.create(LegacyClient.prototype) as LegacyClient;
    Object.assign(legacy, {
      listAllSwaps: async () => swaps,
      retryArkadeToLightningSwap: async () => {
        swaps.push(arkadeEvmSwap);
        return {
          newSwap: { id: "swap-1" },
          refundTxId: "tx",
          refundAmount: 1n,
        };
      },
    });
    const client = new Client(legacy, withManagers(m.map));
    await client.startTracking();

    // Unlike a create, the retry has already refunded into the new VHTLC, so
    // the wrapper must return the result instead of throwing; tracking just
    // skips the unobservable swap.
    await expect(
      client.retryArkadeToLightningSwap("old-swap", {
        lightningAddress: "user@example.com",
      }),
    ).resolves.toMatchObject({ refundTxId: "tx" });
    expect(m.arkade.registered.size).toBe(0);
  });

  it("a concurrent startTracking awaits the in-flight start, not a boolean", async () => {
    const m = managers();
    // Gate the storage load so the first startTracking is reliably mid-flight
    // when the second one comes in.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const legacy = Object.create(LegacyClient.prototype) as LegacyClient;
    Object.assign(legacy, {
      listAllSwaps: async () => {
        await gate;
        return [arkadeEvmSwap];
      },
    });
    const client = new Client(legacy, withManagers(m.map));

    const first = client.startTracking();
    const second = client.startTracking();
    let secondDone = false;
    void second.then(() => {
      secondDone = true;
    });

    // The second call must NOT resolve while the first is still starting —
    // resolving early would let a caller hit subscribeToActions before the
    // tracker exists.
    await new Promise((r) => setTimeout(r, 0));
    expect(secondDone).toBe(false);

    release();
    await Promise.all([first, second]);
    expect(() => client.subscribeToActions(() => {})).not.toThrow();
  });

  it("clears the partial tracker when startTracking fails partway", async () => {
    const m = managers();
    // The EVM leg's register fails, as an RPC/indexer error would. The Arkade leg
    // (registered first) must be torn down, not leaked.
    m.evm.register = async () => {
      throw new Error("rpc down");
    };
    const client = new Client(fakeLegacy([arkadeEvmSwap]), withManagers(m.map));

    await expect(client.startTracking()).rejects.toThrow(/rpc down/);

    // Partial tracker torn down: subscribe still reports not-started, and the
    // Arkade leg that did register was unregistered.
    expect(() => client.subscribeToActions(() => {})).toThrow(/startTracking/);
    expect(m.arkade.registered.size).toBe(0);
  });
});
