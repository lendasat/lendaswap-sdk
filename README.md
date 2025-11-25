# Lendaswap Client SDK

Monorepo containing client SDKs for Lendaswap - Bitcoin-to-stablecoin atomic swaps.

## Structure

This repository contains three interconnected packages:

### [`core/`](./core/) - Rust Core Library

Platform-agnostic Rust library containing:

- API client for the Lendaswap backend
- Type definitions matching the backend API schema
- HTTP request handling with `reqwest`

Used as a dependency by the WASM SDK.

### [`wasm-sdk/`](wasm-sdk/) - WASM Bindings

WebAssembly bindings for the core library:

- `wasm-bindgen` exports for browser/Node.js usage
- JavaScript-friendly type conversions
- Async API methods

Compiled to WASM and consumed by the TypeScript SDK.

### [`ts-sdk/`](./ts-sdk/) - TypeScript SDK

High-level TypeScript/JavaScript SDK:

- Wraps the WASM bindings with idiomatic TypeScript
- HD wallet management for swap parameters
- Storage providers (LocalStorage, IndexedDB, Memory)
- Real-time WebSocket price feed
- Published as `@lendaswap/sdk` on npm

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   ts-sdk (TypeScript)               │
│  - ApiClient, Wallet, PriceFeedService              │
│  - Storage providers                                │
│  - Published to npm as @lendaswap/sdk               │
└─────────────────────┬───────────────────────────────┘
                      │ imports WASM
┌─────────────────────▼───────────────────────────────┐
│                wasm-sdk (WASM)                      │
│  - wasm-bindgen exports                             │
│  - JS-friendly type conversions                     │
└─────────────────────┬───────────────────────────────┘
                      │ depends on
┌─────────────────────▼───────────────────────────────┐
│                  core (Rust)                        │
│  - API types and client                             │
│  - HTTP with reqwest                                │
└─────────────────────────────────────────────────────┘
```

## Building

```bash
# Build everything (WASM + TypeScript)
cd ts-sdk
pnpm install
pnpm run build

# Build only WASM
cd wasm-sdk
wasm-pack build --target web --out-dir ../ts-sdk/wasm

# Build only TypeScript
cd ts-sdk
pnpm run build:ts
```

## Development

```bash
# Format Rust code
cargo fmt --all

# Check Rust code
cargo check --all

# Run Rust tests
cargo test --all
```

## License

MIT
