build-wasm:
    cd wasm-sdk && wasm-pack build --target web --out-dir ../ts-sdk/wasm

release-wasm:
    cd wasm-sdk && wasm-pack build --target web --release --out-dir ../ts-sdk/wasm

build-sdk: build-wasm
    cd ts-sdk && pnpm install && pnpm run build:ts

test-sdk:
    cd ts-sdk && pnpm test
