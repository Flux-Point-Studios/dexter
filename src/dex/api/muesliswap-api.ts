import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { MuesliSwap } from '../muesliswap';
import { RequestConfig } from '@app/types';
import { appendSlash } from '@app/utils';
import { logger } from '@app/utils/logger';

export class MuesliSwapApi extends BaseApi {

    protected readonly api: AxiosInstance;
    protected readonly dex: MuesliSwap;

    constructor(dex: MuesliSwap, requestConfig: RequestConfig) {
        super();

        this.dex = dex;
        this.api = axios.create({
            timeout: requestConfig.timeout,
            baseURL: `${appendSlash(requestConfig.proxyUrl)}https://api.muesliswap.com/`,
            headers: {
                'Content-Type': 'application/json',
            }
        });
    }

    liquidityPools(assetA: Token, assetB?: Token): Promise<LiquidityPool[]> {
        const providers: string[] = ['muesliswap', 'muesliswap_v2', 'muesliswap_clp'];
        const tokenA: string = (assetA === 'lovelace')
            ? '.'
            : assetA.identifier('.');
        const tokenB: string = (assetB && assetB !== 'lovelace')
            ? assetB.identifier('.')
            : '';

        return this.api.get(`/liquidity/pools?providers=${providers.join(',')}&token-a=${tokenA}&token-b=${tokenB}`)
            .then((response: any) => {
                try {
                    const pools = response?.data;

                    if (!Array.isArray(pools)) {
                        logger.warn('[MuesliSwapApi] pools response not an array', {
                            responseType: typeof pools,
                            responseKeys: pools && typeof pools === 'object' ? Object.keys(pools) : [],
                        });
                        return [];
                    }

                    if (!pools.length) {
                        logger.debug('[MuesliSwapApi] pools empty', {
                            tokenA,
                            tokenB,
                        });
                        return [];
                    }

                    return pools
                        .map((pool: any) => {
                            try {
                                // Validate required fields
                                if (!pool?.tokenA || !pool?.tokenB || !pool?.lpToken) {
                                    logger.debug('[MuesliSwapApi] Pool missing required fields', {
                                        hasTokenA: !!pool?.tokenA,
                                        hasTokenB: !!pool?.tokenB,
                                        hasLpToken: !!pool?.lpToken,
                                    });
                                    return undefined;
                                }

                                let liquidityPool: LiquidityPool = new LiquidityPool(
                                    MuesliSwap.identifier,
                                    pool.tokenA.symbol !== 'ADA' && pool.tokenA.address
                                        ? new Asset(pool.tokenA.address.policyId, pool.tokenA.address.name, pool.tokenA.decimalPlaces ?? 0)
                                        : 'lovelace',
                                    pool.tokenB.symbol !== 'ADA' && pool.tokenB.address
                                        ? new Asset(pool.tokenB.address.policyId, pool.tokenB.address.name, pool.tokenB.decimalPlaces ?? 0)
                                        : 'lovelace',
                                    BigInt(pool.tokenA.amount ?? 0),
                                    BigInt(pool.tokenB.amount ?? 0),
                                    pool.batcherAddress ?? '',
                                    this.dex.orderAddress,
                                    this.dex.orderAddress,
                                );

                                liquidityPool.identifier = pool.poolId ?? '';
                                
                                if (pool.lpToken?.address) {
                                    liquidityPool.lpToken = new Asset(pool.lpToken.address.policyId, pool.lpToken.address.name);
                                } else {
                                    liquidityPool.lpToken = new Asset('', '');
                                }
                                
                                liquidityPool.poolFeePercent = Number(pool.poolFee ?? 0);
                                liquidityPool.totalLpTokens = BigInt(pool.lpToken?.amount ?? 0);

                                return liquidityPool;
                            } catch (mapErr: any) {
                                logger.warn('[MuesliSwapApi] Failed to map pool response', {
                                    error: mapErr?.message || String(mapErr),
                                });
                                return undefined;
                            }
                        })
                        .filter((p: LiquidityPool | undefined): p is LiquidityPool => p !== undefined);
                } catch (e: any) {
                    logger.error('[MuesliSwapApi] Error parsing pools response', {
                        error: e?.message || String(e),
                    });
                    return [];
                }
            })
            .catch((e: any) => {
                logger.error('[MuesliSwapApi] pools request failed', {
                    error: e?.message || String(e),
                    tokenA,
                    tokenB,
                });
                return [];
            });
    }

}
