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
 * A single connection carries up to 256 subscriptions; that cap is enforced
 * client-side (see {@link WsStatusSource.subscribe}) because the server silently
 * drops the overflow.
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

  /**
   * Ids actually subscribed on the wire — held at or below the server's
   * per-connection cap, and resent in full on every (re)connect.
   */
  readonly #active = new Set<string>();
  /**
   * Ids we want but have no slot for. Promoted FIFO as slots free (the worker
   * unsubscribes each swap when it reaches a terminal action, so they do free).
   * A queued swap is not broken, only slower: it gets no hints, so it advances
   * on the tracker's at-risk reconciles and the worker's reconnect sweep.
   */
  readonly #pending = new Set<string>();
  readonly #listeners = new Set<(update: SwapStatusUpdate) => void>();
  readonly #reconnectListeners = new Set<() => void>();

  #ws: WebSocketLike | undefined;
  #open = false;
  #stopped = false;
  /** A connect failed or the socket dropped — the next open is a RE-connect. */
  #hadDisruption = false;
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

  /**
   * Emit whenever the socket comes (back) up after a disruption — a drop, or a
   * first connect that had to be retried. NOT emitted on a pristine first open:
   * hints were never live before it, so there is no gap to recover from. While
   * the socket was down, pushed transitions were lost for good (the server only
   * snapshots on subscribe), so a consumer should re-verify its world against
   * the chain on this signal.
   */
  onReconnect(cb: () => void): () => void {
    this.#reconnectListeners.add(cb);
    return () => this.#reconnectListeners.delete(cb);
  }

  /**
   * Track these swap ids — subscribe on the socket now if open, else on next open.
   *
   * Enforces the server's per-connection cap locally. The server silently stops
   * adding once it is full (it breaks out of the loop but still acks every id),
   * so sending more would leave us believing ids are subscribed that will never
   * receive an update. Overflow is queued instead and promoted as slots free.
   */
  subscribe(swapIds: string[]): void {
    const fresh = swapIds.filter(
      (id) => !this.#active.has(id) && !this.#pending.has(id),
    );
    if (fresh.length === 0) return;

    const admitted: string[] = [];
    for (const id of fresh) {
      if (this.#active.size < MAX_SUBSCRIPTIONS) {
        this.#active.add(id);
        admitted.push(id);
      } else {
        this.#pending.add(id);
      }
    }
    if (this.#pending.size > 0)
      console.warn(
        `WsStatusSource: at the server cap of ${MAX_SUBSCRIPTIONS} subscriptions; ${this.#pending.size} swap(s) queued for a slot and will advance on the chain poll until then`,
      );
    if (this.#open && admitted.length > 0)
      this.#sendFrame("subscribe", admitted);
  }

  /** Stop tracking these swap ids, promoting queued ones into the freed slots. */
  unsubscribe(swapIds: string[]): void {
    const dropped: string[] = [];
    for (const id of swapIds) {
      if (this.#active.delete(id)) dropped.push(id);
      else this.#pending.delete(id);
    }
    if (this.#open && dropped.length > 0)
      this.#sendFrame("unsubscribe", dropped);
    this.#promotePending();
  }

  /** Move queued ids into any free slots, subscribing them if the socket is open. */
  #promotePending(): void {
    if (this.#pending.size === 0) return;
    const promoted: string[] = [];
    for (const id of this.#pending) {
      if (this.#active.size >= MAX_SUBSCRIPTIONS) break;
      this.#pending.delete(id);
      this.#active.add(id);
      promoted.push(id);
    }
    if (this.#open && promoted.length > 0)
      this.#sendFrame("subscribe", promoted);
  }

  #connect(): void {
    this.#reconnectTimer = undefined;
    const ws = this.#factory(this.#url);
    this.#ws = ws;
    ws.onopen = () => {
      this.#backoffMs = this.#reconnectMinMs; // reset backoff on a good connection
      // Promote while still marked closed, so the queued ids ride along in the
      // single full resend below instead of being sent twice.
      this.#promotePending();
      this.#open = true;
      if (this.#active.size > 0)
        this.#sendFrame("subscribe", [...this.#active]);
      if (this.#hadDisruption) {
        this.#hadDisruption = false;
        for (const cb of this.#reconnectListeners) cb();
      }
    };
    ws.onmessage = (event) => this.#handleMessage(event.data);
    ws.onclose = () => this.#onDisconnect();
    ws.onerror = () => this.#ws?.close(); // a `close` follows and drives reconnect
  }

  #onDisconnect(): void {
    this.#open = false;
    this.#ws = undefined;
    this.#hadDisruption = true;
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
