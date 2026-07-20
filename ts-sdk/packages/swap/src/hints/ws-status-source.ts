/**
 * A standalone subscriber to the server's swap-status WebSocket (`GET /ws`).
 *
 * Holds a single reconnecting connection, tracks a live set of subscribed swap
 * ids, and emits `{ swapId, status }` on every status transition the server
 * pushes — including the snapshot the server sends right after a subscribe. This
 * is a *hint* feed only: it neither trusts nor acts on the status. A consumer is
 * expected to verify against the chain (the contract managers) before doing
 * anything with it.
 *
 * Protocol (see `swap/src/api/ws.rs`):
 *   → {"op":"subscribe","channel":"swap_status","args":[<uuid>,...]}   (≤64 ids/frame)
 *   ← {"channel":"swap_status","data":{"<uuid>":"<status>",...}}
 *   ← {"op":"subscribed",...} (ack)     ← {"op":...,"message":...} (error)
 * A single connection carries up to 256 subscriptions.
 */
import type { SwapStatus } from "@lendasat/lendaswap-sdk-pure";

/** A status update pushed by the server for one swap. */
export type SwapStatusUpdate = {
  swapId: string;
  status: SwapStatus;
};

/** The minimal WebSocket surface the source needs (the global `WebSocket` satisfies it). */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WsStatusSourceOptions = {
  /** Server base URL (http/https); the `ws(s)://…/ws` endpoint is derived from it. */
  serverUrl: string;
  /** WebSocket factory — defaults to the global `WebSocket` (browsers, Node ≥ 22). */
  webSocketFactory?: (url: string) => WebSocketLike;
  /** Reconnect backoff floor/ceiling (ms). Defaults: 1_000 / 30_000. */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
};

/** Server limits, mirrored from `swap/src/api/ws.rs`. */
const MAX_ARGS_PER_FRAME = 64;
const MAX_SUBSCRIPTIONS = 256;

export class WsStatusSource {
  readonly #url: string;
  readonly #factory: (url: string) => WebSocketLike;
  readonly #reconnectMinMs: number;
  readonly #reconnectMaxMs: number;

  /** The swap ids we want subscribed — resent in full on every (re)connect. */
  readonly #wanted = new Set<string>();
  readonly #listeners = new Set<(update: SwapStatusUpdate) => void>();

  #ws: WebSocketLike | undefined;
  #open = false;
  #stopped = false;
  #backoffMs: number;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: WsStatusSourceOptions) {
    this.#url = toWsUrl(options.serverUrl);
    this.#factory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.#reconnectMinMs = options.reconnectMinMs ?? 1_000;
    this.#reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
    this.#backoffMs = this.#reconnectMinMs;
  }

  /** Open the connection and begin (re)subscribing. Idempotent. */
  start(): void {
    if (this.#ws || this.#reconnectTimer) return;
    this.#stopped = false;
    this.#connect();
  }

  /** Close the connection and stop reconnecting. */
  stop(): void {
    this.#stopped = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#open = false;
    this.#ws?.close();
    this.#ws = undefined;
  }

  /** Emit for each pushed status update. Returns an unsubscribe fn. */
  onStatus(cb: (update: SwapStatusUpdate) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  /** Track these swap ids — subscribe on the socket now if open, else on next open. */
  subscribe(swapIds: string[]): void {
    const fresh = swapIds.filter((id) => !this.#wanted.has(id));
    for (const id of fresh) this.#wanted.add(id);
    if (this.#wanted.size > MAX_SUBSCRIPTIONS)
      console.warn(
        `WsStatusSource: ${this.#wanted.size} subscriptions exceed the server cap of ${MAX_SUBSCRIPTIONS} on one connection`,
      );
    if (this.#open && fresh.length > 0) this.#sendFrame("subscribe", fresh);
  }

  /** Stop tracking these swap ids. */
  unsubscribe(swapIds: string[]): void {
    const present = swapIds.filter((id) => this.#wanted.has(id));
    for (const id of present) this.#wanted.delete(id);
    if (this.#open && present.length > 0)
      this.#sendFrame("unsubscribe", present);
  }

  #connect(): void {
    this.#reconnectTimer = undefined;
    const ws = this.#factory(this.#url);
    this.#ws = ws;
    ws.onopen = () => {
      this.#open = true;
      this.#backoffMs = this.#reconnectMinMs; // reset backoff on a good connection
      if (this.#wanted.size > 0)
        this.#sendFrame("subscribe", [...this.#wanted]);
    };
    ws.onmessage = (event) => this.#handleMessage(event.data);
    ws.onclose = () => this.#onDisconnect();
    ws.onerror = () => this.#ws?.close(); // a `close` follows and drives reconnect
  }

  #onDisconnect(): void {
    this.#open = false;
    this.#ws = undefined;
    if (this.#stopped || this.#reconnectTimer) return;
    const delay = this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, this.#reconnectMaxMs);
    this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
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

    // Data frame: { channel, data: { <swapId>: <status> } }
    if (f.data && typeof f.data === "object") {
      for (const [swapId, status] of Object.entries(
        f.data as Record<string, SwapStatus>,
      ))
        this.#emit({ swapId, status });
      return;
    }
    // Error frame: { op, message }. Ack frames (no data, no message) are ignored.
    if (typeof f.message === "string")
      console.warn(`WsStatusSource: server error: ${f.message}`);
  }

  #emit(update: SwapStatusUpdate): void {
    for (const cb of this.#listeners) cb(update);
  }

  #sendFrame(op: "subscribe" | "unsubscribe", ids: string[]): void {
    for (let i = 0; i < ids.length; i += MAX_ARGS_PER_FRAME) {
      const args = ids.slice(i, i + MAX_ARGS_PER_FRAME);
      this.#ws?.send(JSON.stringify({ op, channel: "swap_status", args }));
    }
  }
}

/** Derive the `ws(s)://host[/path]/ws` endpoint from an http(s) server base URL. */
function toWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  const scheme = url.protocol === "https:" ? "wss" : "ws";
  const path = url.pathname.replace(/\/+$/, "");
  return `${scheme}://${url.host}${path}/ws`;
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
