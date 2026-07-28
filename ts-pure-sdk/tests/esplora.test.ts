import { afterEach, describe, expect, it, vi } from "vitest";
import {
  broadcastTransaction,
  broadcastTransactionWithRetry,
  fetchTransactionOutputs,
  findOutputByAddress,
} from "../src/esplora.js";

const URLS = ["https://primary.example/api", "https://fallback.example/api"];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findOutputByAddress", () => {
  const utxo = {
    txid: "aa".repeat(32),
    vout: 1,
    status: { confirmed: true },
    value: 12345,
  };

  it("uses the first URL when it succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse([utxo]));

    const result = await findOutputByAddress(URLS, "bc1qaddress");

    expect(result).toEqual({ txid: utxo.txid, vout: 1, amount: 12345n });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("primary.example");
  });

  it("falls back to the next URL when the first fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(jsonResponse([utxo]));

    const result = await findOutputByAddress(URLS, "bc1qaddress");

    expect(result).toEqual({ txid: utxo.txid, vout: 1, amount: 12345n });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("fallback.example");
  });

  it("falls back on non-ok responses too", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse([utxo]));

    const result = await findOutputByAddress(URLS, "bc1qaddress");

    expect(result?.txid).toBe(utxo.txid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fall back when the first URL returns an empty UTXO set", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse([]));

    const result = await findOutputByAddress(URLS, "bc1qaddress");

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws the last error when every URL fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("first down"))
      .mockRejectedValueOnce(new Error("second down"));

    await expect(findOutputByAddress(URLS, "bc1qaddress")).rejects.toThrow(
      "second down",
    );
  });

  it("passes a per-request timeout signal so hung endpoints fail over", async () => {
    // First endpoint "hangs" until its timeout signal aborts the request;
    // the SDK must then move on to the fallback URL.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce((_url, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Promise.reject(
          new DOMException("signal timed out", "TimeoutError"),
        );
      })
      .mockResolvedValueOnce(jsonResponse([utxo]));

    const result = await findOutputByAddress(URLS, "bc1qaddress");

    expect(result?.txid).toBe(utxo.txid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("fallback.example");
  });

  it("aborts a hung request after the lookup timeout and fails over", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        // First endpoint hangs forever; only the timeout signal ends it.
        .mockImplementationOnce(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(init.signal?.reason ?? new Error("aborted")),
              );
            }),
        )
        .mockResolvedValueOnce(jsonResponse([utxo]));

      const pending = findOutputByAddress(URLS, "bc1qaddress");
      await vi.advanceTimersByTimeAsync(2_000);

      const result = await pending;
      expect(result?.txid).toBe(utxo.txid);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain("fallback.example");
    } finally {
      vi.useRealTimers();
    }
  });

  it("works without AbortSignal.timeout (React Native/Hermes)", async () => {
    // Hermes provides fetch/AbortController but not the static
    // AbortSignal.timeout helper; lookups must still go through.
    const original = AbortSignal.timeout;
    // biome-ignore lint/suspicious/noExplicitAny: simulating a runtime without the static helper
    (AbortSignal as any).timeout = undefined;
    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([utxo]));

      const result = await findOutputByAddress(URLS, "bc1qaddress");

      expect(result?.amount).toBe(12345n);
    } finally {
      AbortSignal.timeout = original;
    }
  });

  it("still works with a single string URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([utxo]));

    const result = await findOutputByAddress(
      "https://primary.example/api/",
      "bc1qaddress",
    );

    expect(result?.amount).toBe(12345n);
  });
});

describe("fetchTransactionOutputs", () => {
  it("falls back and returns outputs from the second URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ vout: [{ value: 777 }] }));

    const result = await fetchTransactionOutputs(URLS, "bb".repeat(32));

    expect(result?.vout[0].value).toBe(777);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null instead of throwing when every URL fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));

    const result = await fetchTransactionOutputs(URLS, "bb".repeat(32));

    expect(result).toBeNull();
  });
});

describe("broadcastTransaction", () => {
  it("falls back to the next URL on network failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(new Response("txid123", { status: 200 }));

    const txid = await broadcastTransaction(URLS, "deadbeef");

    expect(txid).toBe("txid123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("fallback.example");
  });

  it("prefers a permanent rejection over a transient error", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("sendrawtransaction RPC error: bad-txns-in-belowout", {
          status: 400,
        }),
      )
      .mockRejectedValueOnce(new Error("fetch failed"));

    await expect(broadcastTransaction(URLS, "deadbeef")).rejects.toThrow(
      "bad-txns-in-belowout",
    );
  });
});

describe("broadcastTransactionWithRetry", () => {
  it("does not retry when an explorer permanently rejects the tx", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("sendrawtransaction RPC error: bad-txns-in-belowout", {
        status: 400,
      }),
    );

    await expect(
      broadcastTransactionWithRetry(URLS, "deadbeef", 3),
    ).rejects.toThrow("bad-txns-in-belowout");
    // One pass over both URLs, no retries.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
