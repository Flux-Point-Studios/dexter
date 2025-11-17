# Changelog

All notable changes to this project will be documented in this file.

This project adheres to Semantic Versioning. Dates are in UTC.

## [0.0.6] - 2025-11-09
### Added
- SaturnSwap REST wrappers:
  - `SaturnSwapApi.quoteByAsset(input)` → POST `/v1/aggregator/quote`
  - `SaturnSwapApi.createOrderTransactionFromAsset(input)` → POST `/v1/aggregator/simple/create-from-asset`
- SaturnSwap convenience methods (in `SaturnSwap`):
  - `quoteByAsset(input)`
  - `createFromAssetHex(input)` → first tx hex
  - `buildFromAssetSignSubmit(input, wallet)` → sign+submit locally
### Changed
- README: expanded SaturnSwap section with by-asset quote/build examples, API surface, and troubleshooting.
- Tests: suite passes (53/53).

## [0.0.7] - 2025-11-09
### Changed
- Documentation updates only (README/CHANGELOG). Tag created but not published to npm due to unchanged package version.

## [0.0.8] - 2025-11-09
### Changed
- Bump package version to publish README/CHANGELOG to npm.

## [0.0.9] - 2025-11-09
### Fixed
- Exported `QuoteRequest`/`QuoteResponse`/`CreateFromAssetInput` and annotated return type to satisfy TS4053 in published types.

## [0.0.10] - 2025-11-09
### Added
- SaturnSwap-AMM provider (virtual AMM facade) that:
  - Discovers pools via REST `/v1/aggregator/pools`
  - Implements `estimatedGive/estimatedReceive/priceImpact` using constant-product math from reserves + fee
  - Exposes optional server quote/build wrappers: `ammQuote`, `ammBuildOrder`
- API client additions:
  - `getAmmPools`, `getAmmPoolById`, `ammQuote`, `ammBuildOrder`
### Changed
- Registered `SaturnSwap-AMM` in `Dexter.availableDexs`.
- README: document AMM facade usage and notes.

## [0.0.11] - 2025-11-09
### Changed
- `ammBuildOrder` now returns real unsigned CBOR; README updated to show sign/submit.
- Added `buildAmmSignSubmit` convenience method to `SaturnSwap-AMM`.

## [0.0.14] - 2025-11-13
### Fixed
- Removed all fabricated ID logic - SDK now uses backend's real `poolId` directly (no fabrication).
- Added `poolId` field to `AmmPoolDTO` and `AmmPoolById` interfaces (backend provides both `id` and `poolId` - same value).
- `LiquidityPool.identifier` now uses backend's real `poolId` (from `poolId ?? id`).
- `createAmmUnsignedHex` uses `poolId` directly without any resolution logic.

## [0.0.15] - 2025-11-17
### Added
- `AmmBuildRequest.partnerAddress?` and pass-through in `SaturnSwapAMM.createAmmUnsignedHex` / `buildAmmSignSubmit` to support server-side fee split (1 ADA partner + 1 ADA platform) when provided.
### Changed
- README: documented market swap behavior (tokens returned in same tx) and `partnerAddress` usage in `ammBuildOrder`.
- DexTransaction: `toCbor()` is more robust (falls back to `toHex`/`toCbor`/`to_cbor`) to avoid provider method mismatch.

## [0.0.13] - 2025-11-13
### Fixed
- Default SaturnSwap API host updated from `api.saturnswap.xyz` to `api.saturnswap.io`.
- AMM pools response handling: backend returns array directly (not `{ pools: [...] }`) and `assetA`/`assetB` as strings (not `{ unit: string }`); SDK now handles both formats.

## [0.0.12] - 2025-11-13
### Changed
- Default behavior: only `SaturnSwap-AMM` is registered; CLOB (`SaturnSwap`) is now optional.
- Added `enableSaturnClob` flag in `DexterConfig` (default false) to register the CLOB provider.
- README restructured: AMM is the primary flow; CLOB REST is “Advanced (Optional)” with opt-in instructions.

## [0.0.5] - 2025-11-09
### Fixed
- `package.json` repository/homepage/bugs links updated to `Flux-Point-Studios/dexter`.
### Changed
- Published to npm under `@fluxpointstudios/dexter`.

## [0.0.4] - 2025-11-09
### Fixed
- GitHub Actions publish workflow consolidated; removed duplicate top-level keys.

## [0.0.3] - 2025-11-09
### Fixed
- `utils.appendSlash` now returns the original value when it already ends with `/`.
- Saturn REST client test updated; CI green.

## [0.0.2] - 2025-11-06
### Added
- Initial fork & rename; Bun build retained.
- SaturnSwap REST client and provider scaffold.
- Publish workflow to npm on tag (requires `NPM_TOKEN`).

---

Unreleased changes are tracked in PRs until a tag is pushed.

# Changelog

All notable changes to Dexter will be documented in this file.

## [v5.4.9]
- Splash integration

## [v5.4.0]
- SundaeSwap v3 integration

## [v5.3.0]
- Minswap v2 integration

## [v5.2.0]
- Add `withMinimumReceive(minReceive: bigint)` to SwapRequest

## [v5.1.0]
- Fix cancelling orders for each DEX
- Add new split cancel order request

## [v5.0.0]
- TeddySwap integration
- Spectrum integration

## [v4.2.0]
- Fix WR price impact formula for 0 decimals
- Rename Asset identifier function
- Include '/' helper function for proxy URLs
- Add export for SplitSwapRequest
- Add tests for DexTransaction events
- Fix `withSwapOutAmountMappings` for split swap requests
- Add fetching for total LP tokens for liquidity pools

## [v4.1.0]
- Support for multi-dex swap requests.

## [v4.0.2]
- Fix pool identifiers & LP token for Minswap.

## [v4.0.1]
- Remove total LP tokens from fetched data. This data is not needed for swapping, and wastes a lot of network requests.
- Add `setProviderForDex()` to use different data providers for each DEX.

## [v3.0.3]
- Fix for Minswap calculations with pool fee percents to round before casting.

## [v3.0.2]
- Update DEX template definitions to use a copy of the template, rather than altering the original.
- Fix for WingRiders API.

## [v3.0.1]

- Fix for WingRiders price impact calculation when using a non ADA swap in token.
- Expose address payments in `DexTransaction` instance.
- Update DEX `name` variable to `identifier` to resolve browser related issue with reserved words.

## [v2.0.0]

- Adjust Kupo & Blockfrost data providers to accept an optional `RequestConfig`.
- Cleanup around asset filtering when using `FetchRequest.getLiquidityPools()`.
- Add `FetchRequest.getLiquidityPoolState()` helper to get the latest state for a liquidity pool.
- Liquidity pool fee fix for SundaeSwap when constructing pools from on-chain data. 
- Add ability to retry API requests in the `RequestConfig` options. 
- Add handling for Blockfrost API limit cooldown. 
- Add `SwapRequest.withSwapOutAmount(bigint)` to calculate the estimated swap in amount.
- Add `SwapRequest.withSwapOutToken(Token)` to allow crafting a SwapRequest given the swap out token.
- Update `FetchRequest.forDexs()` to `FetchRequest.onDexs()`.
- Update `FetchRequest.forAllDexs()` to `FetchRequest.onAllDexs()`.
- Add `FetchRequest.forTokens()` & `FetchRequest.forTokenPairs()` for filtering pools containing tokens/token pairs.
- Fix for encrypted Minswap API responses (API still has hard call limits). 
