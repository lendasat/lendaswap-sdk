/**
 * Push-driven EVM HTLC watching over a WebSocket JSON-RPC endpoint:
 * one connection and one standing `eth_subscribe("logs", …)` per chain, with
 * the same batched filter the reader uses (all lifecycle event signatures on
 * topic0, all tracked preimage hashes on topic1, across all HTLC addresses).
 *
 * A pushed log identifies exactly which `(htlc, preimageHash)` changed, so the
 * manager can run one targeted verify — zero requests while nothing happens.
 * The subscription is best-effort by design: every (re)connect also emits a
 * no-argument event telling the caller to run a catch-up scan, and the
 * manager's rate-limited passive scan still backstops a silently dead socket.
 *
 * Free public wss endpoints exist for all supported chains (publicnode, dRPC)
 * and are rotated through on reconnect.
 */

/** A pushed log's identity — enough to route a targeted verify. */
export type EvmHtlcHit = {
  htlc: `0x${string}`;
  preimageHash: `0x${string}`;
};

/** One HTLC to watch; mirrors the reader's query identity. */
export type EvmWatchQuery = {
  htlc: `0x${string}`;
  preimageHash: `0x${string}`;
};

export type EvmLogSubscriber = {
  /**
   * Replace the watched set. An empty set closes the connection; a non-empty
   * one connects (or re-subscribes) as needed.
   */
  setFilter(queries: EvmWatchQuery[]): void;
  /**
   * `hit` per matching pushed log; `undefined` when a connection is
   * (re)established — the caller should run a catch-up scan, since events may
   * have been missed while disconnected. Returns an unsubscribe fn.
   */
  onEvent(cb: (hit?: EvmHtlcHit) => void): () => void;
  dispose(): void;
};

/** Minimal WebSocket surface (mirrors hints/ws-status-source). */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type EvmLogSubscriberOptions = {
  /** The event signatures (topic0) to match — the HTLC lifecycle events. */
  topics0: `0x${string}`[];
  /** WebSocket factory — defaults to the global `WebSocket` (browsers, Node ≥ 22). */
  webSocketFactory?: (url: string) => WebSocketLike;
  /** Reconnect backoff floor/ceiling (ms). Defaults: 1_000 / 30_000. */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
};

/**
 * Free WebSocket JSON-RPC endpoints per supported chainId, rotated on
 * reconnect. (Ankr's free tier and the official Arbitrum endpoint are
 * HTTP-only, so the lists differ from `DEFAULT_EVM_RPCS`.)
 */
export const DEFAULT_EVM_WSS: Record<number, string[]> = {
  1: ["wss://ethereum-rpc.publicnode.com", "wss://eth.drpc.org"],
  137: ["wss://polygon-bor-rpc.publicnode.com", "wss://polygon.drpc.org"],
  42161: ["wss://arbitrum-one-rpc.publicnode.com", "wss://arbitrum.drpc.org"],
};

export function createEvmLogSubscriber(
  urls: string[],
  options: EvmLogSubscriberOptions,
): EvmLogSubscriber {
  return new WsLogSubscriber(urls, options);
}

class WsLogSubscriber implements EvmLogSubscriber {
  readonly #urls: string[];
  readonly #topics0: `0x${string}`[];
  readonly #factory: (url: string) => WebSocketLike;
  readonly #reconnectMinMs: number;
  readonly #reconnectMaxMs: number;

  readonly #listeners = new Set<(hit?: EvmHtlcHit) => void>();
  #queries: EvmWatchQuery[] = [];
  #ws: WebSocketLike | undefined;
  #open = false;
  #disposed = false;
  #urlIndex = 0;
  #backoffMs: number;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #requestId = 1;
  #pendingSubRequestId: number | undefined;
  #subscriptionId: string | undefined;

  constructor(urls: string[], options: EvmLogSubscriberOptions) {
    if (urls.length === 0) throw new Error("no wss urls given");
    this.#urls = urls;
    this.#topics0 = options.topics0;
    this.#factory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.#reconnectMinMs = options.reconnectMinMs ?? 1_000;
    this.#reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
    this.#backoffMs = this.#reconnectMinMs;
  }

  setFilter(queries: EvmWatchQuery[]): void {
    this.#queries = queries;
    if (this.#disposed) return;
    if (queries.length === 0) {
      this.#teardown();
      return;
    }
    if (this.#open) this.#subscribe();
    else if (!this.#ws && !this.#reconnectTimer) this.#connect();
  }

  onEvent(cb: (hit?: EvmHtlcHit) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  dispose(): void {
    this.#disposed = true;
    this.#teardown();
    this.#listeners.clear();
  }

  #teardown(): void {
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    const ws = this.#ws;
    this.#ws = undefined;
    this.#open = false;
    this.#subscriptionId = undefined;
    this.#pendingSubRequestId = undefined;
    ws?.close();
  }

  #connect(): void {
    this.#reconnectTimer = undefined;
    if (this.#disposed || this.#queries.length === 0) return;
    const url = this.#urls[this.#urlIndex % this.#urls.length];
    let ws: WebSocketLike;
    try {
      ws = this.#factory(url);
    } catch (error) {
      console.warn(`EvmLogSubscriber: connect to ${url} failed:`, error);
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;
    ws.onopen = () => {
      this.#open = true;
      this.#backoffMs = this.#reconnectMinMs;
      this.#subscribe();
      // Events may have been missed while disconnected — ask for a catch-up.
      this.#emit(undefined);
    };
    ws.onmessage = (event) => this.#handleMessage(event.data);
    ws.onclose = () => this.#onDisconnect();
    ws.onerror = () => this.#ws?.close(); // close follows and drives reconnect
  }

  #onDisconnect(): void {
    this.#open = false;
    this.#ws = undefined;
    this.#subscriptionId = undefined;
    this.#pendingSubRequestId = undefined;
    if (this.#disposed || this.#queries.length === 0 || this.#reconnectTimer)
      return;
    this.#urlIndex += 1; // rotate to the next endpoint
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    const delay = this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, this.#reconnectMaxMs);
    this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
  }

  /** (Re)establish the logs subscription for the current filter. */
  #subscribe(): void {
    const ws = this.#ws;
    if (!ws) return;
    if (this.#subscriptionId !== undefined) {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: this.#requestId++,
          method: "eth_unsubscribe",
          params: [this.#subscriptionId],
        }),
      );
      this.#subscriptionId = undefined;
    }
    const filter = {
      address: unique(this.#queries.map((q) => q.htlc)),
      topics: [this.#topics0, unique(this.#queries.map((q) => q.preimageHash))],
    };
    this.#pendingSubRequestId = this.#requestId;
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: this.#requestId++,
        method: "eth_subscribe",
        params: ["logs", filter],
      }),
    );
  }

  #handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") return;
    const f = frame as Record<string, unknown>;

    // Subscription ack: { id, result: "0x…" }.
    if (f.id === this.#pendingSubRequestId && typeof f.result === "string") {
      this.#subscriptionId = f.result;
      this.#pendingSubRequestId = undefined;
      return;
    }
    // Pushed log: { method: "eth_subscription", params: { subscription, result } }.
    if (f.method !== "eth_subscription") return;
    const params = f.params as
      | {
          subscription?: string;
          result?: { address?: string; topics?: string[] };
        }
      | undefined;
    if (!params || params.subscription !== this.#subscriptionId) return;
    const log = params.result;
    const preimageHash = log?.topics?.[1];
    if (typeof log?.address !== "string" || typeof preimageHash !== "string")
      return;
    this.#emit({
      htlc: log.address as `0x${string}`,
      preimageHash: preimageHash as `0x${string}`,
    });
  }

  #emit(hit?: EvmHtlcHit): void {
    for (const cb of this.#listeners) cb(hit);
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  const WS = (globalThis as { WebSocket?: new (url: string) => WebSocketLike })
    .WebSocket;
  if (!WS)
    throw new Error(
      "no global WebSocket available — pass options.webSocketFactory (Node < 22)",
    );
  return new WS(url);
}
