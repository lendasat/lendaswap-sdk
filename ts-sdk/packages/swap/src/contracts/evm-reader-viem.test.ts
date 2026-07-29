import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  parseAbiItem,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { htlcQueryKey } from "./evm-manager.js";
import {
  DEFAULT_EVM_RPCS,
  defaultEvmReaders,
  type EvmLogClient,
  evmReaderFromClient,
  MULTICALL3_ADDRESS,
  type RawLog,
} from "./evm-reader-viem.js";

const HTLC = `0x${"11".repeat(20)}` as const;
const PH = `0x${"22".repeat(32)}` as const;
const CLAIM = `0x${"33".repeat(20)}` as const;
const REFUND = `0x${"44".repeat(20)}` as const;
const TOKEN = `0x${"55".repeat(20)}` as const;

const CREATED = parseAbiItem(
  "event SwapCreated(bytes32 indexed preimageHash, address indexed refundAddress, address indexed claimAddress, address token, uint256 amount, uint256 timelock)",
);
const REDEEMED = parseAbiItem(
  "event SwapRedeemed(bytes32 indexed preimageHash, bytes32 preimage)",
);
const REFUNDED = parseAbiItem(
  "event SwapRefunded(bytes32 indexed preimageHash)",
);

/** Raw `eth_getLogs`-shaped logs, properly ABI-encoded so decoding is real. */
function createdLog(
  amount: bigint,
  claimAddress: `0x${string}` = CLAIM,
): RawLog {
  return {
    address: HTLC,
    topics: encodeEventTopics({
      abi: [CREATED],
      args: { preimageHash: PH, refundAddress: REFUND, claimAddress },
    }) as RawLog["topics"],
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [TOKEN, amount, 0n],
    ),
  };
}

function redeemedLog(preimage: `0x${string}`): RawLog {
  return {
    address: HTLC,
    topics: encodeEventTopics({
      abi: [REDEEMED],
      args: { preimageHash: PH },
    }) as RawLog["topics"],
    data: encodeAbiParameters([{ type: "bytes32" }], [preimage]),
  };
}

function refundedLog(): RawLog {
  return {
    address: HTLC,
    topics: encodeEventTopics({
      abi: [REFUNDED],
      args: { preimageHash: PH },
    }) as RawLog["topics"],
    data: "0x",
  };
}

function fakeClient(logs: RawLog[]): EvmLogClient & {
  request: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn(async () => logs),
    call: vi.fn(async () => ({ data: "0x" as const })),
    getBlock: async () => ({ timestamp: 1_700_000_000n, number: 42n }),
  };
}

const IS_ACTIVE = parseAbiItem(
  "function isActive(bytes32 preimageHash, uint256 amount, address token, address sender, address claimAddress, uint256 timelock) view returns (bool)",
);
const AGGREGATE3 = parseAbiItem(
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
);

const boolResult = (value: boolean): `0x${string}` =>
  encodeFunctionResult({ abi: [IS_ACTIVE], result: value });

const activeQueryFor = (htlc: `0x${string}`, preimageHash: `0x${string}`) => ({
  htlc,
  preimageHash,
  amount: 1000n,
  token: TOKEN,
  sender: REFUND,
  claimAddress: CLAIM,
  timelockSec: 1_700_000_000,
});

const QUERY = { htlc: HTLC, preimageHash: PH, claimAddress: CLAIM };
const KEY = htlcQueryKey(QUERY);

describe("evmReaderFromClient", () => {
  it("returns a created event when the swap was funded", async () => {
    const reader = evmReaderFromClient(fakeClient([createdLog(1000n)]));
    const events = (await reader.getHtlcEventsBatch([QUERY])).get(KEY);
    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({ kind: "created", amount: 1000n });
    expect((events?.[0] as { token: string }).token.toLowerCase()).toBe(TOKEN);
  });

  it("drops a SwapCreated paying a different claim address", async () => {
    const other = `0x${"66".repeat(20)}` as const;
    const reader = evmReaderFromClient(fakeClient([createdLog(1000n, other)]));
    expect((await reader.getHtlcEventsBatch([QUERY])).get(KEY)).toEqual([]);
  });

  it("decodes the revealed preimage from a redeem", async () => {
    const preimage = `0x${"ab".repeat(32)}` as const;
    const reader = evmReaderFromClient(
      fakeClient([createdLog(1000n), redeemedLog(preimage)]),
    );
    expect((await reader.getHtlcEventsBatch([QUERY])).get(KEY)).toMatchObject([
      { kind: "created", amount: 1000n },
      { kind: "redeemed", preimage },
    ]);
  });

  it("reports a refund", async () => {
    const reader = evmReaderFromClient(
      fakeClient([createdLog(1000n), refundedLog()]),
    );
    expect((await reader.getHtlcEventsBatch([QUERY])).get(KEY)).toMatchObject([
      { kind: "created", amount: 1000n },
      { kind: "refunded" },
    ]);
  });

  it("maps a queried HTLC with no events to an empty array", async () => {
    const reader = evmReaderFromClient(fakeClient([]));
    expect((await reader.getHtlcEventsBatch([QUERY])).get(KEY)).toEqual([]);
  });

  it("makes no request at all for an empty batch", async () => {
    const client = fakeClient([]);
    const reader = evmReaderFromClient(client);
    expect((await reader.getHtlcEventsBatch([])).size).toBe(0);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("issues ONE eth_getLogs for many HTLCs, ORing addresses and hashes", async () => {
    const ph2 = `0x${"77".repeat(32)}` as const;
    const htlc2 = `0x${"88".repeat(20)}` as const;
    const client = fakeClient([createdLog(1000n)]);
    const reader = evmReaderFromClient(client);

    const result = await reader.getHtlcEventsBatch([
      QUERY,
      { htlc: htlc2, preimageHash: ph2, claimAddress: CLAIM },
    ]);

    expect(client.request).toHaveBeenCalledTimes(1);
    const filter = client.request.mock.calls[0][0].params[0];
    expect(filter.address).toEqual([HTLC, htlc2]);
    expect(filter.topics[1]).toEqual([PH, ph2]);
    expect(filter.fromBlock).toBe("0x0");
    // The log only matches the first query; the second maps to empty.
    expect(result.get(KEY)).toHaveLength(1);
    expect(
      result.get(htlcQueryKey({ htlc: htlc2, preimageHash: ph2 })),
    ).toEqual([]);
  });

  it("skips a log it cannot decode instead of failing the batch", async () => {
    const junk: RawLog = {
      address: HTLC,
      topics: [`0x${"99".repeat(32)}`],
      data: "0x",
    };
    const reader = evmReaderFromClient(fakeClient([junk, createdLog(1000n)]));
    expect((await reader.getHtlcEventsBatch([QUERY])).get(KEY)).toHaveLength(1);
  });

  it("passes fromBlock through as a hex quantity", async () => {
    const client = fakeClient([]);
    const reader = evmReaderFromClient(client);
    await reader.getHtlcEventsBatch([QUERY], 123n);
    expect(client.request.mock.calls[0][0].params[0].fromBlock).toBe("0x7b");
  });

  it("reports the latest block time (ms) and number", async () => {
    const reader = evmReaderFromClient(fakeClient([]));
    expect(await reader.getLatestBlock()).toEqual({
      timeMs: 1_700_000_000_000,
      number: 42n,
    });
  });
});

describe("isActiveBatch", () => {
  it("a single query goes straight to the HTLC contract", async () => {
    const client = fakeClient([]);
    client.call.mockResolvedValueOnce({ data: boolResult(true) });
    const reader = evmReaderFromClient(client);

    const result = await reader.isActiveBatch([activeQueryFor(HTLC, PH)]);

    expect(client.call).toHaveBeenCalledTimes(1);
    expect(client.call.mock.calls[0][0].to).toBe(HTLC);
    expect(result.get(htlcQueryKey({ htlc: HTLC, preimageHash: PH }))).toBe(
      true,
    );
  });

  it("many queries collapse into one Multicall3 eth_call", async () => {
    const htlc2 = `0x${"88".repeat(20)}` as const;
    const ph2 = `0x${"77".repeat(32)}` as const;
    const client = fakeClient([]);
    client.call.mockResolvedValueOnce({
      data: encodeFunctionResult({
        abi: [AGGREGATE3],
        result: [
          { success: true, returnData: boolResult(true) },
          { success: false, returnData: "0x" },
        ],
      }),
    });
    const reader = evmReaderFromClient(client);

    const result = await reader.isActiveBatch([
      activeQueryFor(HTLC, PH),
      activeQueryFor(htlc2, ph2),
    ]);

    expect(client.call).toHaveBeenCalledTimes(1);
    expect(client.call.mock.calls[0][0].to).toBe(MULTICALL3_ADDRESS);
    expect(result.get(htlcQueryKey({ htlc: HTLC, preimageHash: PH }))).toBe(
      true,
    );
    // A failed inner call reads as inactive (the caller's log path classifies).
    expect(result.get(htlcQueryKey({ htlc: htlc2, preimageHash: ph2 }))).toBe(
      false,
    );
  });

  it("falls back to per-HTLC calls when Multicall3 is unavailable", async () => {
    const htlc2 = `0x${"88".repeat(20)}` as const;
    const ph2 = `0x${"77".repeat(32)}` as const;
    const client = fakeClient([]);
    client.call
      .mockResolvedValueOnce({ data: "0x" }) // multicall address is empty → decode fails
      .mockResolvedValueOnce({ data: boolResult(true) })
      .mockResolvedValueOnce({ data: boolResult(false) });
    const reader = evmReaderFromClient(client);

    const result = await reader.isActiveBatch([
      activeQueryFor(HTLC, PH),
      activeQueryFor(htlc2, ph2),
    ]);

    expect(client.call).toHaveBeenCalledTimes(3);
    expect(result.get(htlcQueryKey({ htlc: HTLC, preimageHash: PH }))).toBe(
      true,
    );
    expect(result.get(htlcQueryKey({ htlc: htlc2, preimageHash: ph2 }))).toBe(
      false,
    );
  });
});

describe("defaultEvmReaders", () => {
  it("provides a reader for each chain with tested defaults", () => {
    const readers = defaultEvmReaders();
    expect([...readers.keys()].sort()).toEqual(
      Object.keys(DEFAULT_EVM_RPCS).map(Number).sort(),
    );
  });

  it("keeps the default chains when overriding one", () => {
    const readers = defaultEvmReaders({ 137: "https://my-polygon" });
    expect(readers.has(137)).toBe(true);
    expect(readers.size).toBe(Object.keys(DEFAULT_EVM_RPCS).length);
  });

  it("adds a chain that isn't in the defaults", () => {
    const readers = defaultEvmReaders({ 10: "https://my-optimism" });
    expect(readers.has(10)).toBe(true);
    expect(readers.size).toBe(Object.keys(DEFAULT_EVM_RPCS).length + 1);
  });
});
