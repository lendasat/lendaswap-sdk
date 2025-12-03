build-wasm:
    cd wasm-sdk && wasm-pack build --target web --out-dir ../ts-sdk/wasm

release-wasm:
    cd wasm-sdk && wasm-pack build --target web --release --out-dir ../ts-sdk/wasm

build-sdk: build-wasm
    cd ts-sdk && pnpm install && pnpm run build:ts

test-sdk:
    cd ts-sdk && pnpm test

# Publish the SDK to npm (requires npm login)
publish-npm: release-wasm
    cd ts-sdk && pnpm install && pnpm run publish:npm

# Dry-run publish to npm (shows what would be published)
publish-npm-dry-run: release-wasm
    cd ts-sdk && pnpm install && pnpm run publish:npm:dry-run

# Bump SDK version and publish to npm
publish-npm-version version: release-wasm
    cd ts-sdk && pnpm version {{version}} --no-git-tag-version && pnpm install && pnpm run publish:npm
