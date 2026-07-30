/**
 * A esplora-backed {@link BitcoinChainReader} — the concrete chain source the
 * {@link BitcoinContractManager} uses in production.
 *
 * Kept separate from the manager so the manager stays free of any HTTP/esplora
 * dependency (and unit-testable against a fake reader). A single
 * `GET /address/{addr}/txs` yields both the funding state and the spending
 * input's witness, so no extra round-trips are needed.
 */

import type { BitcoinHtlcFacts } from "./bitcoin.js";
import type { BitcoinChainReader } from "./bitcoin-manager.js";

/** The slice of esplora's tx JSON we read. */
type EsploraTx = {
  vin: Array<{
    witness?: string[];
    prevout?: { scriptpubkey_address?: string } | null;
    sequence?: number;
  }>;
  vout: Array<{ scriptpubkey_address?: string; value?: number }>;
  status?: { confirmed?: boolean; block_height?: number };
};

/**
 * When a funding tx counts as `confirmed` for observation purposes.
 *
 * `minConfirmations: 0` (the default) accepts an UNCONFIRMED funding — with one
 * carve-out: a funding that signals RBF (BIP-125) stays `mempool` until it
 * confirms, because a replaceable funding could be double-spent after the
 * claim has already revealed the preimage in the mempool. `1` restores the
 * strict wait-for-a-block behavior; higher values require the corresponding
 * depth (the reader fetches the tip height to compute it).
 */
export type BitcoinConfirmationPolicy = {
  minConfirmations?: number;
};

/** BIP-125: a tx signals replaceability iff any input's nSequence < 0xfffffffe. */
function signalsRbf(tx: EsploraTx): boolean {
  return tx.vin.some((vin) => (vin.sequence ?? 0xffffffff) < 0xfffffffe);
}

/**
 * Reduce an address's esplora tx history to HTLC facts. If a tx spends an output
 * at the address, that's the resolving spend (its witness classifies claim vs
 * refund); otherwise a tx paying the address is the funding, gated by the
 * confirmation policy (see {@link BitcoinConfirmationPolicy}).
 */
export function htlcFactsFromEsploraTxs(
  txs: EsploraTx[],
  address: string,
  opts?: BitcoinConfirmationPolicy & { tipHeight?: number },
): BitcoinHtlcFacts {
  for (const tx of txs) {
    const spend = tx.vin.find(
      (vin) => vin.prevout?.scriptpubkey_address === address,
    );
    if (spend)
      return {
        funding: "confirmed",
        fundedSats: 0, // already spent — the amount no longer matters
        spendWitness: spend.witness ?? [],
      };
  }
  const funding = txs.find((tx) =>
    tx.vout.some((vout) => vout.scriptpubkey_address === address),
  );
  if (funding) {
    const fundedSats = funding.vout
      .filter((vout) => vout.scriptpubkey_address === address)
      .reduce((sum, vout) => sum + (vout.value ?? 0), 0);
    const minConf = opts?.minConfirmations ?? 0;
    let deepEnough: boolean;
    if (funding.status?.confirmed) {
      deepEnough =
        minConf <= 1 ||
        (opts?.tipHeight !== undefined &&
          funding.status.block_height !== undefined &&
          opts.tipHeight - funding.status.block_height + 1 >= minConf);
    } else {
      deepEnough = minConf === 0 && !signalsRbf(funding);
    }
    return {
      funding: deepEnough ? "confirmed" : "mempool",
      fundedSats,
    };
  }
  return { funding: "absent", fundedSats: 0 };
}

/**
 * Public esplora endpoints tried in rotation (mainnet). blockstream.info runs the
 * reference esplora, so it's API-compatible with mempool.space; spreading calls
 * across both halves the per-provider load and survives one being throttled.
 */
export const DEFAULT_ESPLORA_URLS = [
  "https://mempool.space/api",
  "https://blockstream.info/api",
];

/**
 * Build a {@link BitcoinChainReader} over one or more esplora REST endpoints.
 * With several, each call starts at a rotating endpoint (to spread load across
 * providers) and fails over to the rest on error — so a throttled or failing
 * provider doesn't stall tracking.
 */
export function esploraReader(
  esploraUrls: string | string[],
  fetchImpl: typeof fetch = fetch,
  policy?: BitcoinConfirmationPolicy,
): BitcoinChainReader {
  const bases = (Array.isArray(esploraUrls) ? esploraUrls : [esploraUrls]).map(
    (url) => url.replace(/\/+$/, ""),
  );
  const minConf = policy?.minConfirmations ?? 0;
  let start = 0;
  return {
    async getHtlcFacts(address) {
      const from = start++ % bases.length; // rotate the primary to spread load
      let lastError: unknown;
      for (let i = 0; i < bases.length; i++) {
        const base = bases[(from + i) % bases.length];
        try {
          const res = await fetchImpl(
            `${base}/address/${encodeURIComponent(address)}/txs`,
          );
          if (!res.ok) throw new Error(`esplora ${res.status} at ${base}`);
          const txs = (await res.json()) as EsploraTx[];
          // Depth policies beyond 1 need the tip to compute confirmations;
          // 0 and 1 read straight off the tx's confirmed flag.
          let tipHeight: number | undefined;
          if (minConf > 1) {
            const tip = await fetchImpl(`${base}/blocks/tip/height`);
            if (!tip.ok) throw new Error(`esplora ${tip.status} at ${base}`);
            tipHeight = Number(await tip.text());
          }
          return htlcFactsFromEsploraTxs(txs, address, {
            minConfirmations: minConf,
            tipHeight,
          });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error("no esplora endpoints configured");
    },
  };
}
