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
- Load wallets using a seedphrase or CIP-30 interface using [Lucid](https://github.com/spacebudz/lucid)

### Notes
- You may need to use the flag `--experimental-specifier-resolution=node` when building your project to correctly import Dexter
- All figures/parameters represented as a bigint are denominated in lovelaces

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

### SaturnSwap (REST) Flow

```js
// Configure env (example). You can also set process.env at runtime.
// SATURN_API_BASE_URL=https://api.saturnswap.xyz
// SATURN_API_KEY=your-api-key-or-bearer-token

const dexter = new Dexter();
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
- `SATURN_API_BASE_URL` (e.g., `https://api.saturnswap.xyz`)
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
the lucid provider leverages [Lucid](https://github.com/spacebudz/lucid) to manage your wallet & create transactions.

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
