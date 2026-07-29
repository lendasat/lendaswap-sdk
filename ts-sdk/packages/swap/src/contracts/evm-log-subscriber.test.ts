import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEvmLogSubscriber,
  type EvmHtlcHit,
  type WebSocketLike,
} from "./evm-log-subscriber.js";

const TOPIC0 = ["0xsig1", "0xsig2"] as `0x${string}`[];
const HTLC = "0xhtlc" as const;
const PH = "0xph" as const;

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.onclose?.();
  }
  /** Server side: open the connection. */
  open(): void {
    this.onopen?.();
  }
  /** Server side: deliver a frame. */
  message(frame: object): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  /** Server side: drop the connection. */
  drop(): void {
    this.onclose?.();
  }
  lastFrame(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

describe("EvmLogSubscriber", () => {
  let sockets: FakeSocket[];
  let urls: string[];
  const factory = (url: string): WebSocketLike => {
    urls.push(url);
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  };
  const build = () =>
    createEvmLogSubscriber(["wss://a", "wss://b"], {
      topics0: TOPIC0,
      webSocketFactory: factory,
      reconnectMinMs: 1,
    });

  beforeEach(() => {
    sockets = [];
    urls = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("connects on a non-empty filter and subscribes with the batched filter", () => {
    const sub = build();
    sub.setFilter([{ htlc: HTLC, preimageHash: PH }]);
    expect(sockets).toHaveLength(1);
    sockets[0].open();

    const frame = sockets[0].lastFrame();
    expect(frame.method).toBe("eth_subscribe");
    expect(frame.params).toEqual([
      "logs",
      { address: [HTLC], topics: [TOPIC0, [PH]] },
    ]);
    sub.dispose();
  });

  it("emits a hit for a pushed log on the acked subscription", () => {
    const sub = build();
    const events: (EvmHtlcHit | undefined)[] = [];
    sub.onEvent((hit) => events.push(hit));
    sub.setFilter([{ htlc: HTLC, preimageHash: PH }]);
    sockets[0].open();
    events.length = 0; // drop the connect catch-up event

    const id = sockets[0].lastFrame().id;
    sockets[0].message({ jsonrpc: "2.0", id, result: "0xsub1" });
    sockets[0].message({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: {
        subscription: "0xsub1",
        result: { address: HTLC, topics: [TOPIC0[0], PH] },
      },
    });
    expect(events).toEqual([{ htlc: HTLC, preimageHash: PH }]);
    // A log for a foreign subscription id is ignored.
    sockets[0].message({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: {
        subscription: "0xother",
        result: { address: HTLC, topics: [TOPIC0[0], PH] },
      },
    });
    expect(events).toHaveLength(1);
    sub.dispose();
  });

  it("signals a catch-up (undefined) on every (re)connect and rotates endpoints", () => {
    const sub = build();
    const events: (EvmHtlcHit | undefined)[] = [];
    sub.onEvent((hit) => events.push(hit));
    sub.setFilter([{ htlc: HTLC, preimageHash: PH }]);
    sockets[0].open();
    expect(events).toEqual([undefined]); // initial connect → catch-up scan

    sockets[0].drop();
    vi.advanceTimersByTime(5); // reconnect backoff
    expect(sockets).toHaveLength(2);
    expect(urls[1]).toBe("wss://b"); // rotated to the next endpoint
    sockets[1].open();
    expect(events).toEqual([undefined, undefined]); // reconnect → catch-up again
    expect(sockets[1].lastFrame().method).toBe("eth_subscribe"); // re-subscribed
    sub.dispose();
  });

  it("re-subscribes in place when the filter changes", () => {
    const sub = build();
    sub.setFilter([{ htlc: HTLC, preimageHash: PH }]);
    sockets[0].open();
    const id = sockets[0].lastFrame().id;
    sockets[0].message({ jsonrpc: "2.0", id, result: "0xsub1" });

    sub.setFilter([
      { htlc: HTLC, preimageHash: PH },
      { htlc: "0xother", preimageHash: "0xph2" },
    ]);
    const frames = sockets[0].sent.map((s) => JSON.parse(s));
    expect(frames.at(-2)?.method).toBe("eth_unsubscribe");
    expect(frames.at(-1)?.method).toBe("eth_subscribe");
    expect(frames.at(-1)?.params[1].address).toEqual([HTLC, "0xother"]);
    sub.dispose();
  });

  it("an empty filter closes the socket; dispose stops reconnecting", () => {
    const sub = build();
    sub.setFilter([{ htlc: HTLC, preimageHash: PH }]);
    sockets[0].open();
    sub.setFilter([]);
    expect(sockets[0].closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1); // no reconnect for an empty filter

    sub.dispose();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});
