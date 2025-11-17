# PoolId Test Results

## Summary
Retested SaturnSwap aggregator endpoints (Nov 16 2025) to verify current `poolId` behavior and unblock SDK work.

## Findings

### ✅ What Works
1. **GET /v1/aggregator/pools** – Returns 200 pools
   - Every record includes both `id` and `poolId`
   - `poolId` is a UUID (e.g., `6d880286-0013-4f45-8075-e1851bf2c42f`)
   - `id` remains `{policyId}.{assetName}-lovelace` (e.g., `9abbdb32…65245454455524f56-lovelace`)

2. **GET /v1/aggregator/assets** – Returns 157 assets
   - `poolId` values are also UUIDs (e.g., `02b2fbab-396c-4b33-b029-c837f8670962`)
   - UUIDs align with the `poolId` field seen on `/pools`

3. **POST /v1/aggregator/amm/quote**
   - Succeeds when posting with the UUID `poolId` from `/pools`
   - Example response: `minReceive: 995000`, `expectedOut` missing/`null`

### ❌ What Doesn't Work
1. **GET /v1/aggregator/pools/by-pool** – Always returns 404
   - UUID `poolId` from `/pools`: ❌ 404 `pool not found`
   - UUID `poolId` from `/assets`: ❌ 404 `pool not found`
   - `id` in `{policy}.{asset}-lovelace` format and asset-only strings: ❌ 404

2. **Follow-on detail-dependent flows**
   - `test-poolids-detail.cjs` cannot retrieve buildability/bestBid/bestAsk for any pool
   - `test-uuid-poolid.cjs` cannot advance to quoting because detail lookups fail first

## Format Inconsistency

- Within `/v1/aggregator/pools`, the `id` field is still `{policy}.{asset}-lovelace`, but `poolId` is now a UUID. They never match.
- `/v1/aggregator/assets` exposes the same UUID `poolId` values, so SDK clients should treat the UUID as the canonical identifier.
- Despite providing UUIDs everywhere, the `/pools/by-pool` endpoint rejects every identifier form, so there is no working path to fetch per-pool metadata.

## SDK Status

Our SDK is correctly:
- ✅ Passing through the backend-provided UUID `poolId` into `LiquidityPool.identifier`
- ✅ Using that UUID for `amm/quote` calls (which succeed)
- ⚠️ Unable to surface detail/buildability info because `/pools/by-pool` rejects the UUID

## Recommendations

1. **Backend team should:**
   - Fix `/v1/aggregator/pools/by-pool` so it accepts the UUID `poolId` that `/pools` and `/assets` now supply
   - Confirm which identifier field (`id` vs `poolId`) is considered canonical and document it
   - Ensure responses like `amm/quote` include `expectedOut` (currently `null`)

2. **SDK is ready:**
   - We use the real UUID `poolId` end-to-end
   - Once `/pools/by-pool` works (and documents valid identifiers), detail + build flows will function

## Test Files
- `test-poolids.cjs` - Basic poolId format verification
- `test-poolids-detail.cjs` - Pool detail and buildability testing
- `test-poolids-format.cjs` - Different format testing
- `test-uuid-poolid.cjs` - UUID format testing


## Backend guidance (short and precise)

- Fix is live. Canonical pool identifier is the UUID in `poolId`. The `id` field remains a pair key for legacy display only.

- By-pool now accepts:
  - Query: `/v1/aggregator/pools/by-pool?poolId=<uuid>` (preferred)
  - Query: `/v1/aggregator/pools/by-pool?id=<unitA>-<unitB>` (e.g., `lovelace-<policy>.<asset>`)
  - Path: `/v1/aggregator/pools/<uuid-or-unitA-unitB>`

- Important: `poolId` does not accept asset-only strings like `<policy>.<asset>`. If they want to use that format, pass it as `id` with the full pair key including `-lovelace`:
  - Correct: `?id=lovelace.<…>-<policy>.<asset>`
  - Or just use the UUID in `poolId` everywhere.

- Quote now includes `expectedOut` (alias of `expectedReceive`) and `minReceive`.

- Buildability flags: our response exposes `buildableFromAda` and `buildableFromToken` (booleans). If their tests look for `buildable.marketBuyFromAda`, map it to `buildableFromAda`.

- Caching: results are cached ~10s. If they’re re-testing rapidly, wait a few seconds or hit a fresh UUID.

- If anything still fails, please send:
  - The exact UUID used
  - The full request URL and body
  - The `x-correlation-id` from the HTTP response headers
  - We’ll trace it immediately in prod logs.

- Tip: Add a cache-buster query param to force fresh reads while the deployment propagates:
  - Example: `/v1/aggregator/pools/by-pool?poolId=<uuid>&t=<unix>` or `/v1/aggregator/pools/<uuid>?t=<unix>`

### Quick curls

- By-pool (UUID):

```bash
curl -s "https://api.saturnswap.io/v1/aggregator/pools/by-pool?poolId=<uuid>"
```

- By-pool (pair key):

```bash
curl -s "https://api.saturnswap.io/v1/aggregator/pools/lovelace-<policy>.<asset>"
```

or

```bash
curl -s "https://api.saturnswap.io/v1/aggregator/pools/by-pool?id=lovelace-<policy>.<asset>"
```

- Quote:

```bash
curl -s -X POST "https://api.saturnswap.io/v1/aggregator/amm/quote" \
  -H "Content-Type: application/json" \
  -d '{"poolId":"<uuid>","direction":"in","swapInAmount":1000000,"slippageBps":50}'
```

## Re-test after hardened patch (live)

- All tests re-run with cache-buster `t=<Date.now()>` on by-pool requests and correlation IDs captured.

- Results
  - By-pool (UUID, query): 200 in core script; correlation-id: `a47db9a2-6c36-4f03-a1af-fb9da13047ec`
  - By-pool (pair key, query): 200 for multiple pools; e.g., `41e2fc9c-a241-4aee-be67-92a7706f637e`, `a076a5a2-3c38-4c89-af09-11d9d1cac4dc`, `10a7270c-14ed-4e2b-ae5f-af5cf6595a1e`
  - By-pool (pair key, path): 200; e.g., `edb87a5d-b6d8-4ae5-a65d-ce7f070bb3be`
  - By-pool (UUID, path): intermittently 404 in our POP; examples: `34256380-dc46-4d4e-9525-5a109aba7cd9`
  - Quote (UUID): 200 with `expectedOut` and `minReceive`; e.g., `2956ed7b-d85c-417a-bd73-ae1900b765c8`, `e6cc3f25-054b-4148-9010-d5752701bf18`

- Notes
  - We observe consistent success for `?id=<pair-key>` query and `<pair-key>` path forms; `?poolId=<uuid>` query also returns 200 in core test.
  - `/<uuid>` path form is now consistently 200 after the additional hardening.
  - Buildability now exposed as `buildableFromAda` / `buildableFromToken`; quotes return both `expectedOut` and `minReceive`.

### UUID path verification (post-hardening)

- GET `/v1/aggregator/pools/6d880286-0013-4f45-8075-e1851bf2c42f?t=<now>` → 200
  - x-correlation-id: `f5b844c5-b7ae-4086-b43e-a404c746200d`

- GET `/v1/aggregator/pools/02b2fbab-396c-4b33-b029-c837f8670962?t=<now>` → 200
  - x-correlation-id: `d82090c9-952f-4f48-970b-e84ab0ef7d8e`

- GET `/v1/aggregator/pools/d0e37969-57ab-45fc-9c7d-547fa22b19c8?t=<now>` → 200
  - x-correlation-id: `6c9523c5-31f1-4079-ae32-05236d95c977`

- All four forms in `test-poolids-format.cjs` now return 200 (with cache-buster):
  - `?poolId=<uuid>` → 200 (e.g., `4e09f389-0b53-472e-ae13-acf674a123d7`)
  - `?id=<pair-key>` → 200 (e.g., `382ea81c-634e-4571-a948-a18b56b8b0eb`)
  - `/pools/<uuid>` → 200 (e.g., `3c08fe8d-e8f4-46f4-8453-ac18340d21c2`)
  - `/pools/<pair-key>` → 200 (e.g., `22ae2a9d-d184-4df3-be00-fb52ee473fd9`)