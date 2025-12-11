# @lendasat/lendaswap-sdk

TypeScript/JavaScript SDK for Lendaswap - Bitcoin-to-stablecoin atomic swaps.

## Overview

This SDK provides a high-level interface for interacting with the Lendaswap API, enabling atomic swaps between Bitcoin (
Lightning/Arkade) and EVM stablecoins (USDC, USDT on Polygon/Ethereum).

## Installation

```bash
npm install @lendasat/lendaswap-sdk
# or
pnpm add @lendasat/lendaswap-sdk
```

## Quick Start

### Get Asset Pairs and Quote

```typescript
import {
  Client,
  createDexieWalletStorage,
  createDexieSwapStorage,
} from '@lendasat/lendaswap-sdk';

// Create storage providers (uses IndexedDB via Dexie)
const walletStorage = createDexieWalletStorage();
const swapStorage = createDexieSwapStorage();

// Create client
const client = await Client.create(
  'https://apilendaswap.lendasat.com',
  walletStorage,
  swapStorage,
  'bitcoin',
  'https://arkade.computer'
);

// Initialize wallet (generates or loads mnemonic)
await client.init();

// Get available trading pairs
const pairs = await client.getAssetPairs();
console.log('Available pairs:', pairs);

// Get a quote for swapping 100,000 sats to USDC on Polygon
const quote = await client.getQuote('btc_arkade', 'usdc_pol', 100_000n);
console.log('Exchange rate:', quote.exchange_rate);
console.log('You receive:', quote.min_amount, 'USDC');
console.log('Protocol fee:', quote.protocol_fee);
```

### Arkade to Polygon Swap (with Gelato Auto-Redeem)

This example shows how to swap BTC from Arkade to USDC on Polygon. The swap uses Gelato relay for gasless claiming on
the EVM side.

```typescript
import {
  Client,
  createDexieWalletStorage,
  createDexieSwapStorage,
} from '@lendasat/lendaswap-sdk';

const walletStorage = createDexieWalletStorage();
const swapStorage = createDexieSwapStorage();

const client = await Client.create(
  'https://apilendaswap.lendasat.com',
  walletStorage,
  swapStorage,
  'bitcoin',
  'https://arkade.computer'
);

await client.init();

// Create Arkade → USDC (Polygon) swap
const swap = await client.createArkadeToEvmSwap(
  {
    target_address: '0xYourPolygonAddress',
    target_amount: 10, // 10 USDC
    target_token: 'usdc_pol',
  },
  'polygon'
);

console.log('Swap created:', swap.swap_id);
console.log('Send BTC to Arkade VHTLC to proceed');

// After sending BTC, claim via Gelato (gasless)
// The secret is automatically derived from your wallet
await client.claimGelato(swap.swap_id);
console.log('Swap claimed via Gelato relay!');
```

### USDC (Ethereum) to Lightning Swap

This example shows how to swap USDC on Ethereum to Bitcoin via Lightning. You'll need to sign the EVM transaction using
a wallet like MetaMask.

We recommend using [wagmi](https://wagmi.sh/) with [viem](https://viem.sh/) for React apps,
or [ethers.js](https://docs.ethers.org/) for vanilla JS/TS.

```typescript
import {
  Client,
  createDexieWalletStorage,
  createDexieSwapStorage,
} from '@lendasat/lendaswap-sdk';

const walletStorage = createDexieWalletStorage();
const swapStorage = createDexieSwapStorage();

const client = await Client.create(
  'https://apilendaswap.lendasat.com',
  walletStorage,
  swapStorage,
  'bitcoin',
  'https://arkade.computer'
);

await client.init();

// Create USDC (Ethereum) → Lightning swap
const swap = await client.createEvmToLightningSwap(
  {
    bolt11_invoice: 'lnbc...', // Your Lightning invoice
    user_address: '0xYourEthereumAddress', // Your connected wallet address
    source_token: 'usdc_eth',
  },
  'ethereum'
);

console.log('Swap created:', swap.swap_id);
console.log('Contract address:', swap.contract_address);
console.log('Amount to send:', swap.source_amount);

// Now use your wallet to send the transaction to the HTLC contract
// Example with wagmi/viem:
//
// import { useWriteContract } from 'wagmi';
// const { writeContract } = useWriteContract();
//
// await writeContract({
//   address: swap.contract_address,
//   abi: htlcAbi,
//   functionName: 'deposit',
//   args: [swap.hash_lock, swap.timelock, ...],
//   value: swap.source_amount,
// });
//
// Example with ethers.js:
//
// const signer = await provider.getSigner();
// const contract = new ethers.Contract(swap.contract_address, htlcAbi, signer);
// await contract.deposit(swap.hash_lock, swap.timelock, ...);
```

### Real-time Price Feed (WebSocket)

Subscribe to real-time price updates via WebSocket:

```typescript
import {PriceFeedService} from '@lendasat/lendaswap-sdk';

const priceFeed = new PriceFeedService('https://apilendaswap.lendasat.com');

// Subscribe to price updates
const unsubscribe = priceFeed.subscribe((update) => {
  console.log('Timestamp:', update.timestamp);

  for (const pair of update.pairs) {
    console.log(`${pair.pair}:`);
    console.log(`  1 unit:      ${pair.tiers.tier_1}`);
    console.log(`  100 units:   ${pair.tiers.tier_100}`);
    console.log(`  1,000 units: ${pair.tiers.tier_1000}`);
    console.log(`  5,000 units: ${pair.tiers.tier_5000}`);
  }
});

// Check connection status
console.log('Connected:', priceFeed.isConnected());
console.log('Listeners:', priceFeed.listenerCount());

// Unsubscribe when done
unsubscribe();
```

## Features

- **Client** - Full-featured client for the Lendaswap API with WASM-powered cryptography
- **Wallet Management** - HD wallet derivation for swap parameters
- **Price Feed** - Real-time WebSocket price updates with auto-reconnection
- **Storage Providers** - Dexie (IndexedDB) storage for wallet and swap data
- **Configurable Logging** - Set log level via code or localStorage

## API Reference

### Client

```typescript
const client = await Client.create(
  baseUrl,
  walletStorage,
  swapStorage,
  network,
  arkadeUrl
);

// Initialize wallet
await client.init();
await client.init('your mnemonic phrase'); // Or with existing mnemonic

// Trading pairs and quotes
await client.getAssetPairs();
await client.getQuote(from, to, amount);

// Swap operations
await client.createArkadeToEvmSwap(request, targetNetwork);
await client.createEvmToArkadeSwap(request, sourceNetwork);
await client.createEvmToLightningSwap(request, sourceNetwork);
await client.getSwap(id);
await client.listAllSwaps();

// Claiming and refunding
await client.claimGelato(swapId);        // Gasless EVM claim via Gelato
await client.claimVhtlc(swapId);         // Claim Arkade VHTLC
await client.refundVhtlc(swapId, addr);  // Refund expired VHTLC

// Recovery
await client.recoverSwaps();

// Wallet info
await client.getMnemonic();
await client.getUserIdXpub();
```

### Storage Providers

```typescript
import {
  createDexieWalletStorage,
  createDexieSwapStorage,
} from '@lendasat/lendaswap-sdk';

// Pre-built Dexie (IndexedDB) storage providers
const walletStorage = createDexieWalletStorage();
const swapStorage = createDexieSwapStorage();
```

Or implement custom storage:

```typescript
import type {
  WalletStorageProvider,
  SwapStorageProvider,
} from '@lendasat/lendaswap-sdk';

const walletStorage: WalletStorageProvider = {
  getMnemonic: async () => localStorage.getItem('mnemonic'),
  setMnemonic: async (m) => localStorage.setItem('mnemonic', m),
  getKeyIndex: async () => parseInt(localStorage.getItem('idx') ?? '0'),
  setKeyIndex: async (i) => localStorage.setItem('idx', i.toString()),
};

const swapStorage: SwapStorageProvider = {
  get: async (id) => /* fetch from your storage */,
  store: async (id, data) => /* store to your storage */,
  delete: async (id) => /* delete from your storage */,
  list: async () => /* return all swap IDs */,
  getAll: async () => /* return all swap data */,
};
```

### PriceFeedService

```typescript
import {PriceFeedService} from '@lendasat/lendaswap-sdk';

const priceFeed = new PriceFeedService('https://apilendaswap.lendasat.com');

// Subscribe (auto-connects)
const unsubscribe = priceFeed.subscribe((prices) => {
  console.log('Price update:', prices);
});

// Status
priceFeed.isConnected();
priceFeed.listenerCount();

// Cleanup
unsubscribe();
```

### Logging

```typescript
import { setLogLevel, getLogLevel } from '@lendasat/lendaswap-sdk';

// Set log level programmatically
setLogLevel('debug'); // 'trace' | 'debug' | 'info' | 'warn' | 'error'

// Get current log level
console.log('Current level:', getLogLevel());

// Or set via localStorage (persists across page reloads)
localStorage.setItem('lendaswap_log_level', 'debug');
// Reload page for changes to take effect
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
