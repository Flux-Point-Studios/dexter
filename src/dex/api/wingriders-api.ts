import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { RequestConfig } from '@app/types';
import { WingRiders } from '@dex/wingriders';
import { appendSlash, tokensMatch } from '@app/utils';
import { logger } from '@app/utils/logger';

/**
 * WingRiders API adapter.
 * 
 * WingRiders' GraphQL schema uses a union type for liquidityPools that returns
 * different pool types (LiquidityPoolV1, LiquidityPoolV2, etc.) via inline fragments.
 */
export class WingRidersApi extends BaseApi {

    protected readonly api: AxiosInstance;
    protected readonly dex: WingRiders;

    constructor(dex: WingRiders, requestConfig: RequestConfig) {
        super();

        this.dex = dex;
        this.api = axios.create({
            timeout: requestConfig.timeout,
            baseURL: `${appendSlash(requestConfig.proxyUrl)}https://api.mainnet.wingriders.com/graphql`,
            headers: {
                'Content-Type': 'application/json',
            }
        });
    }

    liquidityPools(assetA: Token, assetB?: Token): Promise<LiquidityPool[]> {
        // Use the new liquidityPools query with inline fragments for different pool types
        return this.api.post('', {
            operationName: 'LiquidityPools',
            query: `
                query LiquidityPools {
                    liquidityPools {
                        __typename
                        ... on LiquidityPoolV1 {
                            issuedShareToken {
                                policyId
                                assetName
                                quantity
                            }
                            tokenA {
                                policyId
                                assetName
                                quantity
                            }
                            tokenB {
                                policyId
                                assetName
                                quantity
                            }
                            treasuryA
                            treasuryB
                            _utxo {
                                address
                            }
                        }
                        ... on LiquidityPoolV2 {
                            issuedShareToken {
                                policyId
                                assetName
                                quantity
                            }
                            tokenA {
                                policyId
                                assetName
                                quantity
                            }
                            tokenB {
                                policyId
                                assetName
                                quantity
                            }
                            treasuryA
                            treasuryB
                            _utxo {
                                address
                            }
                        }
                    }
                }
            `,
            variables: {},
        }).then((response: any) => {
            try {
                const pools = response?.data?.data?.liquidityPools;

                if (!Array.isArray(pools)) {
                    logger.warn('[WingRidersApi] liquidityPools not an array or missing', {
                        responseKeys: response?.data ? Object.keys(response.data) : [],
                        dataKeys: response?.data?.data ? Object.keys(response.data.data) : [],
                        poolsType: typeof pools,
                    });
                    return [];
                }

                if (!pools.length) {
                    logger.debug('[WingRidersApi] liquidityPools empty', {});
                    return [];
                }

                const mappedPools = pools
                    .map((pool: any) => {
                        try {
                            // Validate required fields exist (from inline fragments)
                            if (!pool?.tokenA || !pool?.tokenB || !pool?.issuedShareToken || !pool?._utxo?.address) {
                                logger.debug('[WingRidersApi] Pool missing required fields', {
                                    typename: pool?.__typename,
                                    hasTokenA: !!pool?.tokenA,
                                    hasTokenB: !!pool?.tokenB,
                                    hasIssuedShareToken: !!pool?.issuedShareToken,
                                    hasUtxoAddress: !!pool?._utxo?.address,
                                });
                                return undefined;
                            }

                            const tokenA: Token = pool.tokenA.policyId !== ''
                                ? new Asset(pool.tokenA.policyId, pool.tokenA.assetName)
                                : 'lovelace';
                            const tokenB: Token = pool.tokenB.policyId !== ''
                                ? new Asset(pool.tokenB.policyId, pool.tokenB.assetName)
                                : 'lovelace';

                            // Calculate reserves net of treasury
                            const reserveA = BigInt(pool.tokenA.quantity ?? 0) - BigInt(pool.treasuryA ?? 0);
                            const reserveB = BigInt(pool.tokenB.quantity ?? 0) - BigInt(pool.treasuryB ?? 0);

                            let liquidityPool: LiquidityPool = new LiquidityPool(
                                WingRiders.identifier,
                                tokenA,
                                tokenB,
                                reserveA,
                                reserveB,
                                pool._utxo.address,
                                this.dex.orderAddress,
                                this.dex.orderAddress,
                            );

                            liquidityPool.lpToken = new Asset(pool.issuedShareToken.policyId, pool.issuedShareToken.assetName);
                            liquidityPool.identifier = liquidityPool.lpToken.identifier();
                            liquidityPool.totalLpTokens = BigInt(pool.issuedShareToken.quantity ?? 0);
                            
                            // Default fee for WingRiders pools (0.35%)
                            // Could be adjusted based on pool type if needed
                            liquidityPool.poolFeePercent = 0.35;
                            
                            // Store pool type for reference
                            liquidityPool.extra = {
                                poolType: pool.__typename,
                            };

                            return liquidityPool;
                        } catch (mapErr: any) {
                            logger.warn('[WingRidersApi] Failed to map pool response', {
                                error: mapErr?.message || String(mapErr),
                                typename: pool?.__typename,
                            });
                            return undefined;
                        }
                    })
                    .filter((pool: LiquidityPool | undefined): pool is LiquidityPool => pool !== undefined);

                const filteredPools = mappedPools.filter((pool: LiquidityPool) => {
                    const matchesAssetA = tokensMatch(pool.assetA, assetA) || tokensMatch(pool.assetB, assetA);
                    if (!matchesAssetA) {
                        return false;
                    }

                    if (!assetB) {
                        return true;
                    }

                    return tokensMatch(pool.assetA, assetB) || tokensMatch(pool.assetB, assetB);
                });

                return filteredPools;
            } catch (e: any) {
                logger.error('[WingRidersApi] Error parsing liquidityPools response', {
                    error: e?.message || String(e),
                });
                return [];
            }
        }).catch((e: any) => {
            logger.error('[WingRidersApi] liquidityPools request failed', {
                error: e?.message || String(e),
            });
            return [];
        });
    }

}
