import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { SundaeSwapV1 } from '../sundaeswap-v1';
import { RequestConfig } from '@app/types';
import { appendSlash } from '@app/utils';
import { logger } from '@app/utils/logger';

export class SundaeSwapV1Api extends BaseApi {

    protected readonly api: AxiosInstance;
    protected readonly dex: SundaeSwapV1;

    constructor(dex: SundaeSwapV1, requestConfig: RequestConfig) {
        super();

        this.dex = dex;
        this.api = axios.create({
            timeout: requestConfig.timeout,
            baseURL: `${appendSlash(requestConfig.proxyUrl)}https://stats.sundaeswap.finance/graphql`,
            headers: {
                'Content-Type': 'application/json',
            }
        });
    }

    liquidityPools(assetA: Token, assetB?: Token): Promise<LiquidityPool[]> {
        const maxPerPage: number = 100;

        const assetAId: string = (assetA === 'lovelace')
            ? ''
            : assetA.identifier('.');
        let assetBId: string = (assetB && assetB !== 'lovelace')
            ? assetB.identifier('.')
            : '';

        const getPaginatedResponse = (page: number): Promise<LiquidityPool[]> => {
            return this.api.post('', {
                operationName: 'getPoolsByAssetIds',
                query: `
                    query getPoolsByAssetIds($assetIds: [String!]!, $pageSize: Int, $page: Int) {
                        pools(assetIds: $assetIds, pageSize: $pageSize, page: $page) {
                            ...PoolFragment
                        }
                    }
                    fragment PoolFragment on Pool {
                        assetA {
                            ...AssetFragment
                        }
                        assetB {
                            ...AssetFragment
                        }
                        assetLP {
                            ...AssetFragment
                        }
                        name
                        fee
                        quantityA
                        quantityB
                        quantityLP
                        ident
                        assetID
                    }
                    fragment AssetFragment on Asset {
                        assetId
                        decimals
                    }
                `,
                variables: {
                    page: page,
                    pageSize: maxPerPage,
                    assetIds: [assetBId !== '' ? assetBId : assetAId],
                },
            }).then((response: any) => {
                try {
                    const pools = response?.data?.data?.pools;

                    if (!Array.isArray(pools)) {
                        logger.warn('[SundaeSwapV1Api] pools not an array or missing', {
                            responseKeys: response?.data ? Object.keys(response.data) : [],
                            dataKeys: response?.data?.data ? Object.keys(response.data.data) : [],
                            poolsType: typeof pools,
                            page,
                        });
                        return [];
                    }

                    if (!pools.length) {
                        logger.debug('[SundaeSwapV1Api] pools empty', { page });
                        return [];
                    }

                    const liquidityPools = pools
                        .map((pool: any) => {
                            try {
                                // Validate required fields
                                if (!pool?.assetA || !pool?.assetB || !pool?.assetLP) {
                                    logger.debug('[SundaeSwapV1Api] Pool missing required fields', {
                                        hasAssetA: !!pool?.assetA,
                                        hasAssetB: !!pool?.assetB,
                                        hasAssetLP: !!pool?.assetLP,
                                    });
                                    return undefined;
                                }

                                let liquidityPool: LiquidityPool = new LiquidityPool(
                                    SundaeSwapV1.identifier,
                                    pool.assetA.assetId
                                        ? Asset.fromIdentifier(pool.assetA.assetId, pool.assetA.decimals)
                                        : 'lovelace',
                                    pool.assetB.assetId
                                        ? Asset.fromIdentifier(pool.assetB.assetId, pool.assetB.decimals)
                                        : 'lovelace',
                                    BigInt(pool.quantityA ?? 0),
                                    BigInt(pool.quantityB ?? 0),
                                    this.dex.poolAddress,
                                    this.dex.orderAddress,
                                    this.dex.orderAddress,
                                );

                                liquidityPool.identifier = pool.ident ?? '';
                                liquidityPool.lpToken = pool.assetLP.assetId
                                    ? Asset.fromIdentifier(pool.assetLP.assetId)
                                    : new Asset('', '');
                                liquidityPool.poolFeePercent = Number(pool.fee ?? 0);
                                liquidityPool.totalLpTokens = BigInt(pool.quantityLP ?? 0);

                                return liquidityPool;
                            } catch (mapErr: any) {
                                logger.warn('[SundaeSwapV1Api] Failed to map pool response', {
                                    error: mapErr?.message || String(mapErr),
                                });
                                return undefined;
                            }
                        })
                        .filter((p: LiquidityPool | undefined): p is LiquidityPool => p !== undefined);

                    if (pools.length < maxPerPage) {
                        return liquidityPools;
                    }

                    return getPaginatedResponse(page + 1).then((nextPagePools: LiquidityPool[]) => {
                        return liquidityPools.concat(nextPagePools);
                    });
                } catch (e: any) {
                    logger.error('[SundaeSwapV1Api] Error parsing pools response', {
                        error: e?.message || String(e),
                        page,
                    });
                    return [];
                }
            }).catch((e: any) => {
                logger.error('[SundaeSwapV1Api] pools request failed', {
                    error: e?.message || String(e),
                    page,
                });
                return [];
            });
        };

        return getPaginatedResponse(0);
    }

}
