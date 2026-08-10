import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addressToScriptHash,
  ElectrumWsClient,
  electrumBroadcastTransaction,
  electrumFetchTransactionOutputs,
  electrumFindOutputByAddress,
  electrumWaitForOutputByAddress,
} from "../src/electrum-ws.js";

/**
 * Minimal RFC 6455 WebSocket server (text frames only) so the client can be
 * tested against real sockets without adding a `ws` dependency. Client
 * frames are masked per spec; server frames are sent unmasked.
 */
class MockWsServer {
  readonly #server: Server;
  readonly #sockets = new Set<Socket>();
  /** JSON-RPC request handler: return a result, or throw to send an error. */
  onRequest: (method: string, params: unknown[]) => unknown = () => null;
  requests: Array<{ method: string; params: unknown[] }> = [];

  constructor() {
    this.#server = createServer();
    this.#server.on("upgrade", (req, socket) => {
      const key = req.headers["sec-websocket-key"] as string;
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      this.#sockets.add(socket);
      let buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        let frame = decodeFrame(buffer);
        while (frame) {
          buffer = buffer.subarray(frame.consumed);
          if (frame.opcode === 0x8) {
            socket.end();
            return;
          }
          if (frame.opcode === 0x1) this.#handleText(socket, frame.payload);
          frame = decodeFrame(buffer);
        }
      });
      socket.on("close", () => this.#sockets.delete(socket));
      socket.on("error", () => {});
    });
  }

  #handleText(socket: Socket, payload: Buffer): void {
    const msg = JSON.parse(payload.toString("utf8")) as {
      id: number;
      method: string;
      params: unknown[];
    };
    this.requests.push({ method: msg.method, params: msg.params });
    let response: Record<string, unknown>;
    try {
      response = { id: msg.id, result: this.onRequest(msg.method, msg.params) };
    } catch (error) {
      response = {
        id: msg.id,
        error: {
          code: 1,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    this.sendRaw(socket, JSON.stringify(response));
  }

  /** Push a JSON-RPC notification to every connected client. */
  notify(method: string, params: unknown[]): void {
    const payload = JSON.stringify({ method, params });
    for (const socket of this.#sockets) this.sendRaw(socket, payload);
  }

  sendRaw(socket: Socket, text: string): void {
    socket.write(encodeTextFrame(`${text}\n`));
  }

  async listen(port = 0): Promise<string> {
    await new Promise<void>((resolve) =>
      this.#server.listen(port, "127.0.0.1", resolve),
    );
    const address = this.#server.address();
    if (address === null || typeof address === "string")
      throw new Error("no port");
    return `ws://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}

function decodeFrame(
  buffer: Buffer,
): { opcode: number; payload: Buffer; consumed: number } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  let mask: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, consumed: offset + length };
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

const GENESIS_P2PKH = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
// Independently computed (Python hashlib + manual base58); also the canonical
// example in the ElectrumX protocol docs.
const GENESIS_SCRIPTHASH =
  "8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161";
const BIP173_P2WPKH = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const BIP173_SCRIPTHASH =
  "9623df75239b5daa7f5f03042d325b51498c4bb7059c7748b17049bf96f73888";

describe("addressToScriptHash", () => {
  it("matches the ElectrumX docs vector for a P2PKH address", () => {
    expect(addressToScriptHash(GENESIS_P2PKH, "mainnet")).toBe(
      GENESIS_SCRIPTHASH,
    );
  });

  it("matches the independently computed vector for a P2WPKH address", () => {
    expect(addressToScriptHash(BIP173_P2WPKH, "mainnet")).toBe(
      BIP173_SCRIPTHASH,
    );
  });
});

describe("ElectrumWsClient", () => {
  let server: MockWsServer;
  let client: ElectrumWsClient;

  afterEach(async () => {
    client?.close();
    await server?.close();
  });

  async function setup(): Promise<void> {
    server = new MockWsServer();
    const url = await server.listen();
    client = new ElectrumWsClient(url);
  }

  it("performs request/response over the socket", async () => {
    await setup();
    server.onRequest = (method) => {
      if (method === "blockchain.scripthash.listunspent") {
        return [
          { tx_hash: "ab".repeat(32), tx_pos: 1, height: 0, value: 1234 },
        ];
      }
      return null;
    };
    const output = await electrumFindOutputByAddress(
      client,
      GENESIS_P2PKH,
      "mainnet",
    );
    expect(output).toEqual({
      txid: "ab".repeat(32),
      vout: 1,
      amount: 1234n,
    });
    // The handshake goes out on connect, before the lookup.
    expect(server.requests[0]?.method).toBe("server.version");
    const lookup = server.requests.find(
      (r) => r.method === "blockchain.scripthash.listunspent",
    );
    expect(lookup?.params).toEqual([GENESIS_SCRIPTHASH]);
  });

  it("selects the largest UTXO, not the first — dust must not shadow the deposit", async () => {
    await setup();
    server.onRequest = (method) => {
      if (method === "blockchain.scripthash.listunspent") {
        return [
          { tx_hash: "0a".repeat(32), tx_pos: 3, height: 0, value: 330 },
          { tx_hash: "0b".repeat(32), tx_pos: 0, height: 0, value: 1_515_686 },
          { tx_hash: "0c".repeat(32), tx_pos: 1, height: 0, value: 546 },
        ];
      }
      return null;
    };
    const output = await electrumFindOutputByAddress(
      client,
      GENESIS_P2PKH,
      "mainnet",
    );
    expect(output).toEqual({
      txid: "0b".repeat(32),
      vout: 0,
      amount: 1_515_686n,
    });
  });

  it("keeps a subscription through a server outage and resubscribes", async () => {
    server = new MockWsServer();
    const url = await server.listen();
    const port = Number(url.split(":").pop());
    await server.close(); // server down at subscribe time

    client = new ElectrumWsClient(url);
    const onChange = vi.fn();
    await expect(
      client.subscribeScriptHash(GENESIS_SCRIPTHASH, onChange),
    ).rejects.toThrow(); // transport failure — but the handler must survive

    // Server comes back on the same port; the reconnect loop (1s first
    // retry) must re-issue the subscription without any caller involvement.
    server = new MockWsServer();
    await server.listen(port);
    await vi.waitFor(
      () => {
        expect(
          server.requests.some(
            (r) => r.method === "blockchain.scripthash.subscribe",
          ),
        ).toBe(true);
      },
      { timeout: 10_000 },
    );

    // A push after recovery reaches the retained handler.
    server.notify("blockchain.scripthash.subscribe", [
      GENESIS_SCRIPTHASH,
      "post-recovery",
    ]);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("returns null for an address with no UTXOs", async () => {
    await setup();
    server.onRequest = () => [];
    const output = await electrumFindOutputByAddress(
      client,
      GENESIS_P2PKH,
      "mainnet",
    );
    expect(output).toBeNull();
  });

  it("propagates broadcast rejection messages verbatim", async () => {
    await setup();
    server.onRequest = (method) => {
      if (method === "blockchain.transaction.broadcast") {
        throw new Error(
          "the transaction was rejected by network rules. (bad-txns-inputs-missingorspent)",
        );
      }
      return null;
    };
    await expect(
      electrumBroadcastTransaction(client, "deadbeef"),
    ).rejects.toThrow(/bad-txns-inputs-missingorspent/);
  });

  it("parses raw transaction outputs", async () => {
    await setup();
    // 1-in 2-out legacy tx (valid encoding; inputs don't matter here):
    // outputs of 1500 and 2500 sats to OP_TRUE-style scripts.
    const rawTx =
      "0200000001" +
      "00".repeat(32) + // prev txid
      "00000000" + // prev vout
      "00" + // empty scriptSig
      "ffffffff" +
      "02" + // two outputs
      "dc05000000000000" + // 1500 sats
      "0151" + // script: OP_TRUE
      "c409000000000000" + // 2500 sats
      "0151" +
      "00000000";
    server.onRequest = (method) => {
      if (method === "blockchain.transaction.get") return rawTx;
      return null;
    };
    const tx = await electrumFetchTransactionOutputs(client, "ab".repeat(32));
    expect(tx?.vout.map((v) => v.value)).toEqual([1500, 2500]);
  });

  it("returns null when the server does not know the transaction", async () => {
    await setup();
    server.onRequest = (method) => {
      if (method === "blockchain.transaction.get") {
        throw new Error("No such mempool or blockchain transaction");
      }
      return null;
    };
    const tx = await electrumFetchTransactionOutputs(client, "ab".repeat(32));
    expect(tx).toBeNull();
  });

  it("resolves a funding wait from a subscription push", async () => {
    await setup();
    let funded = false;
    server.onRequest = (method) => {
      if (method === "blockchain.scripthash.subscribe") return null;
      if (method === "blockchain.scripthash.listunspent") {
        return funded
          ? [{ tx_hash: "cd".repeat(32), tx_pos: 0, height: 0, value: 9999 }]
          : [];
      }
      return null;
    };

    const wait = electrumWaitForOutputByAddress(
      client,
      GENESIS_P2PKH,
      "mainnet",
      10_000,
    );
    // Let the subscription land, then push a status change.
    await new Promise((resolve) => setTimeout(resolve, 100));
    funded = true;
    server.notify("blockchain.scripthash.subscribe", [
      GENESIS_SCRIPTHASH,
      "somestatus",
    ]);

    const output = await wait;
    expect(output).toEqual({
      txid: "cd".repeat(32),
      vout: 0,
      amount: 9999n,
    });
  });

  it("resolves immediately when the address is already funded", async () => {
    await setup();
    server.onRequest = (method) => {
      if (method === "blockchain.scripthash.subscribe") return "somestatus";
      if (method === "blockchain.scripthash.listunspent") {
        return [{ tx_hash: "ef".repeat(32), tx_pos: 2, height: 100, value: 5 }];
      }
      return null;
    };
    const output = await electrumWaitForOutputByAddress(
      client,
      GENESIS_P2PKH,
      "mainnet",
      10_000,
    );
    expect(output).toEqual({ txid: "ef".repeat(32), vout: 2, amount: 5n });
  });

  it("resolves null when the wait times out", async () => {
    await setup();
    server.onRequest = (method) => {
      if (method === "blockchain.scripthash.subscribe") return null;
      if (method === "blockchain.scripthash.listunspent") return [];
      return null;
    };
    const output = await electrumWaitForOutputByAddress(
      client,
      GENESIS_P2PKH,
      "mainnet",
      300,
    );
    expect(output).toBeNull();
  });

  it("rejects the wait when the server is unreachable", async () => {
    server = new MockWsServer();
    const url = await server.listen();
    await server.close();
    client = new ElectrumWsClient(url);
    await expect(
      electrumWaitForOutputByAddress(client, GENESIS_P2PKH, "mainnet", 5_000),
    ).rejects.toThrow();
  });
});
