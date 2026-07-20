import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type SwapStatusUpdate,
  type WebSocketLike,
  WsStatusSource,
} from "./ws-status-source.js";

/** A controllable WebSocket: capture sent frames, drive open/message/close from tests. */
class MockSocket implements WebSocketLike {
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

  // Test drivers:
  open(): void {
    this.onopen?.();
  }
  push(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function build(serverUrl = "http://localhost:3333") {
  const sockets: MockSocket[] = [];
  let lastUrl = "";
  const src = new WsStatusSource({
    serverUrl,
    reconnectMinMs: 10,
    reconnectMaxMs: 100,
    webSocketFactory: (url) => {
      lastUrl = url;
      const s = new MockSocket();
      sockets.push(s);
      return s;
    },
  });
  return {
    src,
    sockets,
    last: () => sockets[sockets.length - 1],
    url: () => lastUrl,
  };
}

describe("WsStatusSource", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives the ws endpoint from the server url", () => {
    expect(build("http://localhost:3333").url).toBeDefined();
    const http = build("http://localhost:3333");
    http.src.start();
    expect(http.url()).toBe("ws://localhost:3333/ws");

    const https = build("https://api.satora.io");
    https.src.start();
    expect(https.url()).toBe("wss://api.satora.io/ws");
  });

  it("subscribes tracked ids once the socket opens", () => {
    const { src, last } = build();
    src.subscribe(["a", "b"]);
    src.start();
    last().open();
    expect(last().frames()).toEqual([
      { op: "subscribe", channel: "swap_status", args: ["a", "b"] },
    ]);
  });

  it("subscribes new ids immediately when already open", () => {
    const { src, last } = build();
    src.start();
    last().open();
    src.subscribe(["x"]);
    expect(last().frames()).toContainEqual({
      op: "subscribe",
      channel: "swap_status",
      args: ["x"],
    });
  });

  it("emits (swapId, status) for each entry of a data frame", () => {
    const { src, last } = build();
    const seen: SwapStatusUpdate[] = [];
    src.onStatus((u) => seen.push(u));
    src.start();
    last().open();
    last().push({
      channel: "swap_status",
      data: { a: "serverfunded", b: "pending" },
    });
    expect(seen).toEqual([
      { swapId: "a", status: "serverfunded" },
      { swapId: "b", status: "pending" },
    ]);
  });

  it("batches subscribes into frames of at most 64 ids", () => {
    const { src, last } = build();
    const ids = Array.from({ length: 70 }, (_, i) => `id${i}`);
    src.subscribe(ids);
    src.start();
    last().open();
    const subs = last()
      .frames()
      .filter((f) => f.op === "subscribe");
    expect(subs.map((f) => (f.args as string[]).length)).toEqual([64, 6]);
  });

  it("never subscribes more than the server's per-connection cap", () => {
    const { src, last } = build();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 300 > the 256 cap: the server would silently drop the overflow.
    src.subscribe(Array.from({ length: 300 }, (_, i) => `id${i}`));
    src.start();
    last().open();

    const sent = last()
      .frames()
      .filter((f) => f.op === "subscribe")
      .flatMap((f) => f.args as string[]);
    expect(sent).toHaveLength(256);
    expect(new Set(sent).size).toBe(256); // no duplicates
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("queued"));
    warn.mockRestore();
  });

  it("promotes a queued id into the slot freed by an unsubscribe", () => {
    const { src, last } = build();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    src.subscribe(Array.from({ length: 256 }, (_, i) => `id${i}`));
    src.start();
    last().open();
    src.subscribe(["overflow"]); // no slot — queued, not sent
    expect(
      last()
        .frames()
        .flatMap((f) => f.args as string[]),
    ).not.toContain("overflow");

    src.unsubscribe(["id0"]); // frees exactly one slot
    expect(last().frames()).toContainEqual({
      op: "subscribe",
      channel: "swap_status",
      args: ["overflow"],
    });
    vi.restoreAllMocks();
  });

  it("drains the whole queue as finalized swaps free their slots", () => {
    const { src, last } = build();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ids = Array.from({ length: 300 }, (_, i) => `id${i}`);
    src.subscribe(ids); // 256 admitted, 44 queued
    src.start();
    last().open();

    // Finalize the swaps holding the first 44 slots, one at a time — exactly what
    // the worker does when each reaches a terminal action.
    for (let i = 0; i < 44; i++) src.unsubscribe([`id${i}`]);

    const subscribed = new Set(
      last()
        .frames()
        .filter((f) => f.op === "subscribe")
        .flatMap((f) => f.args as string[]),
    );
    // Every one of the 300 eventually made it onto the wire — nothing stranded.
    for (const id of ids) expect(subscribed.has(id)).toBe(true);
    vi.restoreAllMocks();
  });

  it("unsubscribes and stops tracking an id", () => {
    const { src, last } = build();
    src.subscribe(["a", "b"]);
    src.start();
    last().open();
    src.unsubscribe(["a"]);
    expect(last().frames()).toContainEqual({
      op: "unsubscribe",
      channel: "swap_status",
      args: ["a"],
    });
  });

  it("ignores ack frames and logs error frames", () => {
    const { src, last } = build();
    const seen: SwapStatusUpdate[] = [];
    src.onStatus((u) => seen.push(u));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    src.start();
    last().open();
    last().push({ op: "subscribed", channel: "swap_status", args: ["a"] });
    last().push({ op: "subscribe", message: "subscription limit reached" });
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("limit reached"));
    warn.mockRestore();
  });

  it("reconnects after a drop and re-subscribes the wanted ids", () => {
    vi.useFakeTimers();
    const { src, sockets, last } = build();
    src.subscribe(["a"]);
    src.start();
    last().open();

    last().onclose?.(); // socket drops
    vi.advanceTimersByTime(10); // backoff elapses → reconnect
    expect(sockets.length).toBe(2);

    last().open();
    expect(last().frames()).toContainEqual({
      op: "subscribe",
      channel: "swap_status",
      args: ["a"],
    });
  });

  it("stop() closes the socket and does not reconnect", () => {
    vi.useFakeTimers();
    const { src, sockets, last } = build();
    src.start();
    last().open();
    src.stop();
    expect(last().closed).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(sockets.length).toBe(1);
  });
});
