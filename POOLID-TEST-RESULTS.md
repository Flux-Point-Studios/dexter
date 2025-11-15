# PoolId Test Results

## Summary
Tested SaturnSwap API endpoints to verify poolId format and functionality.

## Findings

### ✅ What Works
1. **GET /v1/aggregator/pools** - Returns 200 pools successfully
   - All pools have both `id` and `poolId` fields
   - `id` and `poolId` match (same value) ✅
   - Format: `{policyId}.{assetName}-lovelace` (e.g., `9abbdb321bfd029e14063b0779c9b41e9a3337d1f9d2973f957f4363.23465245454455524f56-lovelace`)

2. **GET /v1/aggregator/assets** - Returns 157 assets successfully
   - Assets have `poolId` in UUID format (e.g., `02b2fbab-396c-4b33-b029-c837f8670962`)
   - Format differs from `/pools` endpoint

### ❌ What Doesn't Work
1. **GET /v1/aggregator/pools/by-pool** - Returns 500 Internal Server Error
   - Tested with poolId from `/pools` endpoint: ❌ 500
   - Tested with poolId from `/assets` endpoint (UUID): ❌ 500
   - Tested without `-lovelace` suffix: ❌ 404 (pool not found)

2. **POST /v1/aggregator/amm/quote** - Returns 500 Internal Server Error
   - Tested with poolId from `/pools` endpoint: ❌ 500
   - Cannot test with UUID format due to detail endpoint failure

## Format Inconsistency

The backend returns **different poolId formats** from different endpoints:

- **`/v1/aggregator/pools`**: `{policyId}.{assetName}-lovelace` format
- **`/v1/aggregator/assets`**: UUID format (`02b2fbab-396c-4b33-b029-c837f8670962`)

This is a **backend inconsistency** that needs to be addressed.

## SDK Status

Our SDK is correctly:
- ✅ Using the `poolId` field from `/pools` response (no fabrication)
- ✅ Storing it as `LiquidityPool.identifier`
- ✅ Passing it directly to quote/build endpoints

The 500 errors are **backend issues**, not SDK issues.

## Recommendations

1. **Backend team should:**
   - Fix 500 errors on `/v1/aggregator/pools/by-pool` endpoint
   - Fix 500 errors on `/v1/aggregator/amm/quote` endpoint
   - Standardize poolId format across all endpoints (either UUID or policyId.assetName-lovelace, but not both)

2. **SDK is ready:**
   - We're using real poolIds from the backend (no fabrication)
   - Once backend fixes the 500 errors, everything should work

## Test Files
- `test-poolids.cjs` - Basic poolId format verification
- `test-poolids-detail.cjs` - Pool detail and buildability testing
- `test-poolids-format.cjs` - Different format testing
- `test-uuid-poolid.cjs` - UUID format testing

