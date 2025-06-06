import { BaseDataProvider } from '@providers/data/base-data-provider';
import { AvailableDexs, DexterConfig, RequestConfig } from '@app/types';
import { Minswap } from '@dex/minswap';
import { SundaeSwapV1 } from '@dex/sundaeswap-v1';
import { MuesliSwap } from '@dex/muesliswap';
import { WingRiders } from '@dex/wingriders';
import { SwapRequest } from '@requests/swap-request';
import { BaseWalletProvider } from '@providers/wallet/base-wallet-provider';
import { BaseDex } from '@dex/base-dex';
import { VyFinance } from '@dex/vyfinance';
import { BaseMetadataProvider } from '@providers/asset-metadata/base-metadata-provider';
import { TokenRegistryProvider } from '@providers/asset-metadata/token-registry-provider';
import { CancelSwapRequest } from '@requests/cancel-swap-request';
import { FetchRequest } from '@requests/fetch-request';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { SplitSwapRequest } from '@requests/split-swap-request';
import { SplitCancelSwapRequest } from '@requests/split-cancel-swap-request';
import { SundaeSwapV3 } from '@dex/sundaeswap-v3';
import { MinswapV2 } from '@dex/minswap-v2';
import { WingRidersV2 } from '@dex/wingriders-v2';
import { Splash } from '@dex/splash';
import { SaturnSwap } from '@dex/saturnswap';

export class Dexter {

    public config: DexterConfig;
    public requestConfig: RequestConfig;

    public dataProvider?: BaseDataProvider;
    public walletProvider?: BaseWalletProvider;
    public metadataProvider: BaseMetadataProvider;

    public availableDexs: AvailableDexs;

    constructor(config: DexterConfig = {}, requestConfig: RequestConfig = {}) {
        this.config = Object.assign(
            {},
            {
                shouldFetchMetadata: true,
                shouldFallbackToApi: true,
                shouldSubmitOrders: false,
                metadataMsgBranding: 'Dexter',
            } as DexterConfig,
            config,
        );
        this.requestConfig = Object.assign(
            {},
            {
                timeout: 5000,
                proxyUrl: '',
                retries: 3,
            } as RequestConfig,
            requestConfig,
        );

        // Axios configurations
        axiosRetry(axios, { retries: this.requestConfig.retries });
        axios.defaults.timeout = this.requestConfig.timeout;

        this.metadataProvider = new TokenRegistryProvider(this.requestConfig);
        this.availableDexs = {
            [Minswap.identifier]: new Minswap(this.requestConfig),
            [SundaeSwapV1.identifier]: new SundaeSwapV1(this.requestConfig),
            [SundaeSwapV3.identifier]: new SundaeSwapV3(this.requestConfig),
            [MinswapV2.identifier]: new MinswapV2(this.requestConfig),
            [MuesliSwap.identifier]: new MuesliSwap(this.requestConfig),
            [WingRiders.identifier]: new WingRiders(this.requestConfig),
            [WingRidersV2.identifier]: new WingRidersV2(this.requestConfig),
            [VyFinance.identifier]: new VyFinance(this.requestConfig),
            [Splash.identifier]: new Splash(this.requestConfig),
            [SaturnSwap.identifier]: new SaturnSwap(this.requestConfig),
        };
    }

    /**
     * Retrieve DEX instance from unique name.
     */
    public dexByName(name: string): BaseDex | undefined {
        return this.availableDexs[name];
    }

    /**
     * Switch to a new data provider.
     */
    public withDataProvider(dataProvider: BaseDataProvider): Dexter {
        this.dataProvider = dataProvider;

        return this;
    }

    /**
     * Switch to a new wallet provider.
     */
    public withWalletProvider(walletProvider: BaseWalletProvider): Dexter {
        this.walletProvider = walletProvider;

        return this;
    }

    /**
     * Switch to a new asset metadata provider.
     */
    public withMetadataProvider(metadataProvider: BaseMetadataProvider): Dexter {
        this.metadataProvider = metadataProvider;

        return this;
    }

    /**
     * New request for data fetching.
     */
    public newFetchRequest(): FetchRequest {
        return new FetchRequest(this);
    }

    /**
     * New request for a swap order.
     */
    public newSwapRequest(): SwapRequest {
        return new SwapRequest(this);
    }

    /**
     * New request for a split swap order.
     */
    public newSplitSwapRequest(): SplitSwapRequest {
        return new SplitSwapRequest(this);
    }

    /**
     * New request for cancelling a swap order.
     */
    public newCancelSwapRequest(): CancelSwapRequest {
        if (! this.walletProvider) {
            throw new Error('Wallet provider must be set before requesting a cancel order.');
        }
        if (! this.walletProvider.isWalletLoaded) {
            throw new Error('Wallet must be loaded before requesting a cancel order.');
        }

        return new CancelSwapRequest(this);
    }

    /**
     * New request for a split cancel swap order.
     */
    public newSplitCancelSwapRequest(): SplitCancelSwapRequest {
        if (! this.walletProvider) {
            throw new Error('Wallet provider must be set before requesting a split cancel order.');
        }
        if (! this.walletProvider.isWalletLoaded) {
            throw new Error('Wallet must be loaded before requesting a split cancel order.');
        }

        return new SplitCancelSwapRequest(this);
    }

}
