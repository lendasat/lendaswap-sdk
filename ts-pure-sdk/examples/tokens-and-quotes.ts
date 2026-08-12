/**
 * Tokens & Quotes: list available tokens and get quotes for
 * USDT ↔ Arkade BTC in both directions.
 */

import {
  Client,
  InMemorySwapStorage,
  InMemoryWalletStorage,
} from "../src/index.js";

// #region setup
const client = await Client.builder()
  .withSignerStorage(new InMemoryWalletStorage())
  .withSwapStorage(new InMemorySwapStorage())
  .withOrgCode(process.env.ORG_CODE || "")
  .build();
// #endregion setup

// #region get-tokens
const tokens = await client.getTokens();

console.log("=== BTC tokens ===");
for (const t of tokens.btc_tokens) {
  console.log(`  ${t.symbol} on ${t.chain} (${t.decimals} decimals)`);
}
// ... BTC on Arkade (8 decimals)
// ... BTC on Bitcoin (8 decimals)

console.log("\n=== EVM tokens ===");
for (const t of tokens.evm_tokens) {
  console.log(
    `  ${t.symbol} on chain ${t.chain} — ${t.token_id} (${t.decimals} decimals)`,
  );
}
// ... USDT on chain 137 — 0xc2132d05... (6 decimals)
// ... USDC on chain 137 — 0x3c499c54... (6 decimals)
// ... WBTC on chain 137 — 0x1bfd6703... (8 decimals)
// ... tBTC on chain 1   — 0x18084fba... (18 decimals)
// ... etc.
// #endregion get-tokens

// #region find-pair
const usdtPolygon = tokens.evm_tokens.find(
  (t) => t.symbol === "USDT" && t.chain === "137",
);
if (!usdtPolygon) throw new Error("USDT on Polygon not found");

const btcArkade = tokens.btc_tokens.find((t) => t.chain === "Arkade");
if (!btcArkade) throw new Error("BTC on Arkade not found");
// #endregion find-pair

// #region quote-sell-btc
// Quote: sell 100,000 sats (0.001 BTC) for USDT on Polygon
const sellBtcQuote = await client.getQuote({
  sourceChain: btcArkade.chain,
  sourceToken: btcArkade.token_id,
  targetChain: usdtPolygon.chain,
  targetToken: usdtPolygon.token_id,
  sourceAmount: 100_000, // 100,000 sats
});

console.log("\n=== Arkade BTC → USDT (Polygon) ===");
console.log(`  Selling:      100,000 sats (0.001 BTC)`);
console.log(
  `  You receive:  ${sellBtcQuote.target_amount} USDT smallest units`,
);
console.log(`  Exchange rate: ${sellBtcQuote.exchange_rate}`);
console.log(`  Network fee:  ${sellBtcQuote.network_fee} sats`);
console.log(
  `  Protocol fee: ${sellBtcQuote.protocol_fee} sats (${sellBtcQuote.protocol_fee_rate * 100}%)`,
);
console.log(
  `  Limits:       ${sellBtcQuote.min_amount}–${sellBtcQuote.max_amount} sats`,
);
// #endregion quote-sell-btc

// #region quote-buy-btc
// Quote: sell 50 USDT (50,000,000 smallest units) for Arkade BTC
const buyBtcQuote = await client.getQuote({
  sourceChain: usdtPolygon.chain,
  sourceToken: usdtPolygon.token_id,
  targetChain: btcArkade.chain,
  targetToken: btcArkade.token_id,
  sourceAmount: 50_000_000, // 50 USDT (6 decimals)
});

console.log("\n=== USDT (Polygon) → Arkade BTC ===");
console.log(`  Selling:      50 USDT`);
console.log(`  You receive:  ${buyBtcQuote.target_amount} sats`);
console.log(`  Exchange rate: ${buyBtcQuote.exchange_rate}`);
console.log(`  Network fee:  ${buyBtcQuote.network_fee} sats`);
console.log(
  `  Protocol fee: ${buyBtcQuote.protocol_fee} sats (${buyBtcQuote.protocol_fee_rate * 100}%)`,
);
console.log(
  `  Limits:       ${buyBtcQuote.min_amount}–${buyBtcQuote.max_amount} sats`,
);
// #endregion quote-buy-btc
