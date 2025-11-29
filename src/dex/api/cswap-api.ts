import { BaseApi } from './base-api';
import { AxiosInstance } from 'axios';
import axios from 'axios';
import { RequestConfig } from '@app/types';
import { CSwap } from '@dex/cswap';

/**
 * Placeholder API for CSWAP. Currently unused (on-chain discovery by address).
 */
export class CSwapApi extends BaseApi {

    protected readonly api: AxiosInstance;
    protected readonly dex: CSwap;

    constructor(dex: CSwap, requestConfig: RequestConfig = {}) {
        super();
        this.dex = dex;
        this.api = axios.create({
            timeout: requestConfig.timeout ?? 5000,
        });
    }

    async liquidityPools(): Promise<any[]> {
        // CSWAP uses on-chain pool discovery via the pool address.
        // If CSWAP shares a pairs endpoint later, wire it here.
        return [];
    }
}


