build-wasm:
    cd ts-sdk && pnpm build:wasm

release-wasm:
    cd ts-sdk && pnpm build:wasm:release

build-sdk: build-wasm
    cd ts-sdk && pnpm install && pnpm run build:ts

build-release: release-wasm
    cd ts-sdk && pnpm install && pnpm run build:release

test-sdk:
    cd ts-sdk && pnpm test

# Bump SDK version and publish to npm
bump-npm-version version: release-wasm
    cd ts-sdk && pnpm version {{ version }} --no-git-tag-version

# Dry-run publish to npm (shows what would be published)
publish-npm-dry-run: release-wasm
    cd ts-sdk && pnpm install && pnpm run publish:npm:dry-run

# Publish the SDK to npm (requires npm login)
publish-npm: release-wasm
    cd ts-sdk && pnpm install && pnpm run publish:npm
