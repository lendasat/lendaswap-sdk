# @lendaswap/sdk

TypeScript/JavaScript SDK for Lendaswap - Bitcoin-to-stablecoin atomic swaps.

## Overview

This SDK provides a high-level interface for interacting with the Lendaswap API, enabling atomic swaps between Bitcoin (Lightning/Arkade) and EVM stablecoins (USDC, USDT on Polygon/Ethereum).

## Installation

```bash
npm install @lendaswap/sdk
# or
pnpm add @lendaswap/sdk
```

## Quick Start

```typescript
import { ApiClient } from '@lendaswap/sdk';

// Create an API client
const api = await ApiClient.create('https://api.lendaswap.com');

// Get available trading pairs
const pairs = await api.getAssetPairs();

// Get a quote for swapping 100,000 sats to USDC
const quote = await api.getQuote('btc_arkade', 'usdc_pol', 100000n);
console.log('Exchange rate:', quote.exchange_rate);
console.log('You receive:', quote.min_amount, 'USDC');
```

## Features

- **API Client** - Full-featured client for the Lendaswap REST API
- **Wallet Management** - HD wallet derivation for swap parameters
- **Price Feed** - Real-time WebSocket price updates
- **Storage Providers** - LocalStorage, IndexedDB, and in-memory options

## API Reference

### ApiClient

```typescript
const api = await ApiClient.create(baseUrl);

// Trading pairs and quotes
await api.getAssetPairs();
await api.getQuote(from, to, amount);

// Swap operations
await api.createArkadeToEvmSwap(request, network);
await api.createEvmToArkadeSwap(request, network);
await api.createEvmToLightningSwap(request, network);
await api.getSwap(id);
await api.claimGelato(swapId, secret);

// Recovery
await api.recoverSwaps(xpub);
```

### Wallet

```typescript
import { Wallet, LocalStorageProvider } from '@lendaswap/sdk';

const storage = new LocalStorageProvider();
const wallet = await Wallet.create(storage, 'bitcoin');

// Generate or retrieve mnemonic
const mnemonic = await wallet.generateOrGetMnemonic();

// Derive swap parameters (preimage, hash lock, keys)
const params = await wallet.deriveSwapParams();
```

### PriceFeedService

```typescript
import { PriceFeedService } from '@lendaswap/sdk';

const priceFeed = new PriceFeedService('https://api.lendaswap.com');

priceFeed.subscribe((prices) => {
  console.log('Price update:', prices);
});

priceFeed.connect();
```

## Supported Tokens

| Token | Chain     | ID              |
| ----- | --------- | --------------- |
| BTC   | Lightning | `btc_lightning` |
| BTC   | Arkade    | `btc_arkade`    |
| USDC  | Polygon   | `usdc_pol`      |
| USDT  | Polygon   | `usdt0_pol`     |
| USDC  | Ethereum  | `usdc_eth`      |
| USDT  | Ethereum  | `usdt_eth`      |

## License

MIT
