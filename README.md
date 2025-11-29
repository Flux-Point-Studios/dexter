<div align="center">
    <h1 align="center">Dexter</h1>
    <p align="center">Customizable Typescript SDK for interacting with Cardano DEXs.</p>
    <img src="https://raw.githubusercontent.com/IndigoProtocol/dexter/master/src/dex/logo/sundaeswap.png" width="30" />
    <img src="https://raw.githubusercontent.com/IndigoProtocol/dexter/master/src/dex/logo/minswap.png" width="30" /> 
    <img src="https://raw.githubusercontent.com/IndigoProtocol/dexter/master/src/dex/logo/minswapv2.png" width="30" /> 
    <img src="https://raw.githubusercontent.com/IndigoProtocol/dexter/master/src/dex/logo/muesliswap.png" width="30" />
    <img src="https://raw.githubusercontent.com/IndigoProtocol/dexter/master/src/dex/logo/wingriders.png" width="30" />
    <img src="https://raw.githubusercontent.com/IndigoProtocol/dexter/master/src/dex/logo/wingridersv2.png" width="30" />
    <img src="https://raw.githubusercontent.com/IndigoProtocol/dexter/master/src/dex/logo/vyfinance.png" width="30" />
    <img src="https://raw.githubusercontent.com/IndigoProtocol/dexter/master/src/dex/logo/splash.png" width="30" />
</div>

### What You Can Do
- Pull Liquidity Pools from DEX APIs or On-chain using [Blockfrost](https://blockfrost.io/) / [Kupo](https://github.com/CardanoSolutions/kupo)
- Submit and cancel swap orders
- Submit split swap orders across multple DEXs
- Build your own data, wallet, or asset metadata providers to plug into Dexter
- Build swap datums given specific parameters using Dexters _Definition Builder_
- Load wallets using a seedphrase or CIP-30 interface using [@lucid-evolution/lucid](https://github.com/lucid-evolution/lucid)

### CSWAP (Hybrid AMM Orderbook)
- On-chain pool discovery via CSWAP Dex Pool address (ADA pairs only).
- Fee model:
  - Pool fee from pool datum `lp_fee_10k` (e.g., 85 → 0.85%).
  - Batcher fee: 690,000 lovelace.
  - Per-order min deposit: 2,000,000 lovelace (returned upon fill/cancel).
  - Platform fee per 10k: 15 (applied to target min output in datum).

```ts
import { Dexter, CSwap, BlockfrostProvider, LucidProvider } from '@fluxpointstudios/dexter';

const dexter = new Dexter();
const wallet = new LucidProvider();
await wallet.loadWalletFromSeedPhrase(
  ['...seed words...'],
  { accountIndex: 0 },
  { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: '<BLOCKFROST_PROJECT_ID>' }
);
dexter.withWalletProvider(wallet);

const data = new BlockfrostProvider(
  { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: '<BLOCKFROST_PROJECT_ID>' }
);
dexter.withDataProvider(data);

const cswap = dexter.dexByName(CSwap.identifier) as CSwap;
const pools = await cswap.liquidityPools(data);
const pool = pools.find(p => p.assetA === 'lovelace') || pools[0];

const tx = await dexter.newSwapRequest()
  .forLiquidityPool(pool)
  .withSwapInToken('lovelace')
  .withSwapInAmount(2_000_000n)   // 2 ADA
  .withSlippagePercent(0.5)
  .complete();

// sign and submit as needed:
// await tx.sign(); const hash = await tx.submit();
```

#### CSWAP Pricing helpers
This is the AMM pool’s implied price. Orderbook best bid/ask could differ; we can extend to read order UTxOs at the orderbook address to synthesize a live spread if needed.

```ts
import { getAmmImpliedPrice, getOrderbookTopOfBook, Asset } from '@fluxpointstudios/dexter';

// AMM-implied (from pool reserves)
const pools = await dexter.newFetchRequest()
  .onDexs(CSwap.identifier)
  .getLiquidityPools();
const pool = pools.find(p => p.assetA === 'lovelace')!;
const { adaPerToken, tokenPerAda } = getAmmImpliedPrice(pool);

// Orderbook top-of-book (best bid/ask)
const token = Asset.fromIdentifier('<policyId><assetNameHex>');
const top = await getOrderbookTopOfBook(dexter.dataProvider!, token.identifier());
console.log({ adaPerToken, tokenPerAda, top });
```

### Notes
- You may need to use the flag `--experimental-specifier-resolution=node` when building your project to correctly import Dexter
- All figures/parameters represented as a bigint are denominated in lovelaces
- Optional platform fee hook: set `DEXTER_PLATFORM_FEE_ADDRESS` and/or `DEXTER_PLATFORM_FEE_LOVELACE` (lovelace bigint string) to force every swap request to include a fixed ADA payment to your treasury. Defaults are always enabled (2 ADA to Flux Point Studios) in this fork, so override these env vars if you need a different destination or amount.
- **Blockfrost Proxy Support**: Dexter now supports proxy-based Blockfrost configuration via environment variables. Set `BLOCKFROST_PROXY_URL` and `BLOCKFROST_PROXY_PROJECT_ID` to use your proxy endpoint. If not set, it falls back to direct Blockfrost credentials (`BLOCKFROST_URL` and `BLOCKFROST_PROJECT_ID`). This is particularly useful for production deployments with centralized API management.

### Install

##### NPM
```
npm i @fluxpointstudios/dexter
```

##### Yarn
```
yarn add @fluxpointstudios/dexter
```

### Quick Start

```js
const dexterConfig: DexterConfig = {
    shouldFetchMetadata: true,      // Whether to fetch asset metadata (Best to leave this `true` for accurate pool info)
    shouldFallbackToApi: true,      // Only use when using Blockfrost or Kupo as data providers. On failure, fallback to the DEX API to grab necessary data
    shouldSubmitOrders: false,      // Allow Dexter to submit orders from swap requests. Useful during development
    metadataMsgBranding: 'Dexter',  // Prepend branding name in Tx message
};
const requestConfig: RequestConfig = {
    timeout: 5000,  // How long outside network requests have to reply
    proxyUrl: '',   // URL to prepend to all outside URLs. Useful when dealing with CORs
    retries: 3,     // Number of times to reattempt any outside request
};

const dexter: Dexter = new Dexter(dexterConfig, requestConfig);

// Basic fetch example
dexter.newFetchRequest()
    .onAllDexs()
    .getLiquidityPools()
    .then((pools: LiquidityPool[]) => {
        console.log(pools);
    });

// Example loading wallet to be used in a swap
const lucidProvider: BaseWalletProvider = new LucidProvider();

lucidProvider
    .loadWallet(cip30Interface, {
        url: 'https://cardano-mainnet.blockfrost.io/api/v0',
        projectId: '<blockfrost-project-id>'
    })
    .then((walletProvider: BaseWalletProvider) => {
        dexter.withWalletProvider(walletProvider)
            .newFetchRequest()
            ...
    });
```

### Saturn defaults for SaturnSwap
- By default, Dexter registers the AMM facade provider `SaturnSwap-AMM` only (no API key required).
- The CLOB/REST provider `SaturnSwap` is optional and disabled by default.
- To enable the CLOB/REST provider, pass `{ enableSaturnClob: true }` in your `DexterConfig`.

```ts
import { Dexter, SaturnSwapAMM } from '@fluxpointstudios/dexter';

const dexter = new Dexter({ enableSaturnClob: false }); // default
const amm = dexter.dexByName(SaturnSwapAMM.identifier);
```

### SaturnSwap-AMM (virtual AMM facade)
For apps that prefer AMM-like math and pool discovery (like Minswap/WingRiders), you can use the Saturn AMM facade:

```ts
import { Dexter, SaturnSwapAMM } from '@fluxpointstudios/dexter';

const dexter = new Dexter();
const amm = dexter.dexByName(SaturnSwapAMM.identifier) as SaturnSwapAMM;

// Pull AMM pools via REST
const pools = await amm.liquidityPools();
console.log('AMM pools', pools.length);

// AMM math (constant product) works like other providers
const pool = pools[0];
const estimated = amm.estimatedReceive(pool, 'lovelace', 1_000_000n); // 1 ADA in lovelace

// Optional server quote/build (on-chain units)
const quote = await (amm.api as any).ammQuote({
  poolId: pool.identifier, direction: 'in', swapInAmount: 1_000_000, slippageBps: 50
});
// Build a market swap (returns tokens in same tx). Optionally include partnerAddress for fee split.
const hex = await (amm.api as any).ammBuildOrder({
  poolId: pool.identifier,
  direction: 'in',
  swapInAmount: 1_000_000,
  slippageBps: 50,
  changeAddress: '<bech32>',
  partnerAddress: '<optional-partner-bech32>' // 1 ADA partner + 1 ADA platform; if omitted, 2 ADA to platform
});

// Sign and submit locally
const tx = wallet.newTransactionFromHex(hex.unsignedCborHex);
await tx.sign();
await tx.submit();
```

Notes:
- `ammBuildOrder` returns unsigned CBOR; sign/submit locally with your wallet.
- Spot Market swap by default.
- Server-enforced fee outputs: 2 ADA total; with `partnerAddress`, 1/1 split between partner and platform; otherwise 2 ADA to platform.
- Pool snapshots are cached ~1–2s; re-quote if you need a fresh snapshot for minReceive checks.

### SaturnSwap (Advanced REST) [Optional]

```js
// Configure env (example). You can also set process.env at runtime.
// SATURN_API_BASE_URL=https://api.saturnswap.io
// SATURN_API_KEY=your-api-key-or-bearer-token

// Enable the CLOB provider when constructing Dexter
const dexter = new Dexter({ enableSaturnClob: true });
const wallet = new LucidProvider();
await wallet.loadWallet(cip30Interface, {
    url: 'https://cardano-mainnet.blockfrost.io/api/v0',
    projectId: '<blockfrost-project-id>'
});

dexter.withWalletProvider(wallet);

// A) High-level: quote and build-by-asset (no need to pick poolId)
const saturn = dexter.dexByName('SaturnSwap');

// By-asset quote (no Authorization required)
const quote = await (saturn as any).quoteByAsset({
  asset: '<policyId><assetNameHex>', // '' if ADA
  direction: 3,                      // 3 = MarketBuy (ADA → token), 4 = MarketSell (token → ADA)
  tokenAmountSell: 1.0,              // display units (ADA or token), not on-chain units
  tokenAmountBuy: 0,                 // 0 with slippage=null lets builder choose fills
  slippage: null                     // set a number (e.g., 0.5) only if you also set tokenAmountBuy
});
console.log('quote:', quote);

// Build from asset (Authorization required via SATURN_API_KEY)
// Returns first unsigned tx hex if buildable at this moment
const hex = await (saturn as any).createFromAssetHex({
  asset: '<policyId><assetNameHex>',
  direction: 3,
  tokenAmountSell: 1.0,   // try 1–2 ADA (very small sizes like 0.5 ADA can be rejected by min-output rules)
  tokenAmountBuy: 0,
  slippage: null,
  paymentAddress: wallet.address()
});

// Sign + submit locally (or use advanced/sign for pre-cosigned flows)
if (hex) {
  const tx = wallet.newTransactionFromHex(hex);
  await tx.sign();
  await tx.submit();
  console.log('Submitted:', tx.hash);
}

// B) Lower-level: build via specific poolId (if you want to route yourself)
// const input = {
//   paymentAddress: wallet.address(),
//   limitOrderComponents: [
//     { poolId: '...', tokenAmountSell: 1000000, tokenAmountBuy: 500000, limitOrderType: 0, version: 1 }
//   ]
// };
// const txHash = await (saturn as any).buildSignSubmitViaApi(input, wallet);
// console.log('Submitted:', txHash);
```

Environment variables:
- `SATURN_API_BASE_URL` (e.g., `https://api.saturnswap.io`)
- `SATURN_API_KEY` or `SATURN_API_TOKEN` (will be sent as `Authorization: Bearer <value>`)

#### SaturnSwap by-asset inputs at a glance
- `asset`: concatenation of `policyId + assetNameHex` (no separator). Use empty string `''` for ADA.
- `direction`:
  - `3` MarketBuy (spend ADA → receive token). `tokenAmountSell` is ADA (display units).
  - `4` MarketSell (sell token → receive ADA). `tokenAmountSell` is token amount (display units).
- `tokenAmountSell` / `tokenAmountBuy`: display units (we scale by decimals internally).
- `slippage`:
  - When `tokenAmountBuy = 0`, set `slippage = null` (builder treats buy=0+slippage as a hard fail).
  - To enforce minimum output, first call `quote`, then set `tokenAmountBuy = quote.expectedBuy` and `slippage = e.g., 0.5`.

#### SaturnSwap API surface in this SDK
- Discovery:
  - `SaturnSwapApi.assets()`: GET `/v1/aggregator/assets`
  - `SaturnSwapApi.orderbook(assetA, assetB)`: GET `/v1/aggregator/orderbook`
  - `SaturnSwapApi.quoteByAsset(input)`: POST `/v1/aggregator/quote`
- Build / Sign / Submit:
  - `SaturnSwapApi.createOrderTransactionSimple(...)`: POST `/v1/aggregator/simple/create-order-transaction`
  - `SaturnSwapApi.createOrderTransactionFromAsset(input)`: POST `/v1/aggregator/simple/create-from-asset`
  - `SaturnSwapApi.signOrderTransactionAdvanced(...)`: POST `/v1/aggregator/advanced/sign-order-transaction`
  - `SaturnSwapApi.submitOrderTransactionSimple(...)`: POST `/v1/aggregator/simple/submit-order-transaction`
- Dexter convenience (in `SaturnSwap`):
  - `quoteByAsset(input)`
  - `createFromAssetHex(input)` → hex
  - `buildFromAssetSignSubmit(input, wallet)` → txHash
  - Legacy pool-based helpers: `buildSwapOrder(...)`, `createSimpleOrderHexViaApi(...)`, `buildSignSubmitViaApi(...)`

#### Troubleshooting tips
- Pool-specific depth: an asset may have bids/asks overall but your chosen pool could be empty at build time. Use `quoteByAsset` (auto-routes to a spendable pool).  
- Small sizes: very small ADA spends (e.g., 0.5) can fail due to min-output/fee constraints—try ≥1–2 ADA.
- Units: always send display units (ADA or token). Do not pre-scale to on-chain units.

### Dexter API
All providers outlined below are modular, so you can extend the 'base' of the specific provider you want to supply, and provide it
to Dexter with one of the methods below.

<details>
<summary><code>dexByName(string): BaseDex | undefined</code> Grab a DEX instance by name.</summary>

##### Using

```js
dexter.dexByName(Minswap.identifier)
    ...
```
</details>

<br>

<details>
<summary><code>withDataProvider(BaseDataProvider): Dexter</code> Set where Dexter should grab liquidity pool data.</summary>

By default, Dexter will use the DEX APIs to grab information. However, you can use
[Blockfrost](https://github.com/IndigoProtocol/dexter/blob/master/docs/providers/data.md) or
[Kupo](https://github.com/IndigoProtocol/dexter/blob/master/docs/providers/data.md) to supply your own data.

##### Using

```js
const provider: BaseDataProvider = new BlockfrostProvider(
    {
        url: 'https://cardano-mainnet.blockfrost.io/api/v0',
        projectId: '<blockfrost-project-id>',
    }
);

dexter.withDataProvider(provider)
    ...
```
</details>

<br>

<details>
<summary><code>withWalletProvider(BaseWalletProvider): Dexter</code> Set who Dexter sends wallet requests to.</summary>

At this time, Dexter only supplies a Mock wallet provider & a [Lucid provider](./docs/providers/wallet.md). Behind the scenes,
the lucid provider leverages [@lucid-evolution/lucid](https://github.com/lucid-evolution/lucid) to manage your wallet & create transactions.

**Blockfrost Configuration**: The `LucidProvider` automatically resolves Blockfrost configuration from environment variables:
- **Proxy mode** (preferred for production): Set `BLOCKFROST_PROXY_URL` and `BLOCKFROST_PROXY_PROJECT_ID` environment variables
- **Direct mode**: Set `BLOCKFROST_URL` (optional, defaults to mainnet) and `BLOCKFROST_PROJECT_ID` environment variables

You can still pass explicit `BlockfrostConfig` objects, but if omitted, the provider will use the environment-based resolution.

##### Using

```js
const provider: BaseWalletProvider = new LucidProvider();
const seedphrase: string[] = ['...'];
const blockfrostConfig: BlockfrostConfig = {
    url: 'https://cardano-mainnet.blockfrost.io/api/v0',
    projectId: '<blockfrost-project-id>',
};

provider.loadWalletFromSeedPhrase(seedphrase, blockfrostConfig)
    .then((walletProvider: BaseWalletProvider) => {
        dexter.withWalletProvider(walletProvider)
            ...
    });
```
</details>

<br>

<details>
<summary><code>withMetadataProvider(BaseMetadataProvider): Dexter</code> Set where Dexter grabs necessary asset metadata.</summary>

By default, Dexter will use the [Cardano Token Registry](https://github.com/cardano-foundation/cardano-token-registry) for grabbing
asset metadata. You can extend the `BaseMetadataProvider` interface to provide your own metadata.

##### Using

```js
const provider: BaseMetadataProvider = new TokenRegistryProvider();

dexter.withMetadataProvider(provider)
    ...
```
</details>

<br>

<details>
<summary><code>newFetchRequest(): FetchRequest</code> Create new request for liquidity pool data.</summary>

For available methods on the `FetchRequest` instance, please see those specific
[docs](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/fetch-request.md).

##### Using

```js
dexter.newFetchRequest()
    ...
```
</details>

<br>

<details>
<summary><code>newSwapRequest(): SwapRequest</code> Create new request for a swap order.</summary>

For available methods on the `SwapRequest` instance, please see those specific
[docs](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/swap-request.md).

##### Using

```js
dexter.newSwapRequest()
    ...
```
</details>

<br>

<details>
<summary><code>newSplitSwapRequest(): SplitSwapRequest</code> Create new request for a split swap order.</summary>

For available methods on the `SplitSwapRequest` instance, please see those specific
[docs](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/split-swap-request.md).

##### Using

```js
dexter.newSplitSwapRequest()
    ...
```
</details>

<br>

<details>
<summary><code>newCancelSwapRequest(): CancelSwapRequest</code> Create new request for cancelling a swap order.</summary>

For available methods on the `CancelSwapRequest` instance, please see those specific
[docs](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/cancel-swap-request.md).

##### Using

```js
dexter.newCancelSwapRequest()
    ...
```
</details>

<br>

<details>
<summary><code>newSplitCancelSwapRequest(): SplitCancelSwapRequest</code> Create new request for cancelling multiple swap orders.</summary>

For available methods on the `SplitCancelSwapRequest` instance, please see those specific
[docs](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/split-cancel-swap-request.md).

##### Using

```js
dexter.newSplitCancelSwapRequest()
    ...
```
</details>

### More Docs

- [Data Providers](https://github.com/IndigoProtocol/dexter/blob/master/docs/providers/data.md)
- [Wallet Providers](https://github.com/IndigoProtocol/dexter/blob/master/docs/providers/wallet.md)
- [Creating a Fetch Request](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/fetch-request.md)
- [Creating a Swap Request](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/swap-request.md)
- [Creating a Split Swap Request](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/split-swap-request.md)
- [Creating a Cancel Swap Request](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/cancel-swap-request.md)
- [Creating a Split Cancel Swap Request](https://github.com/IndigoProtocol/dexter/blob/master/docs/requests/split-cancel-swap-request.md)
- [Listening for transaction events](https://github.com/IndigoProtocol/dexter/blob/master/docs/dex-transaction.md)
- [Commonly returned models](https://github.com/IndigoProtocol/dexter/blob/master/docs/models.md)
