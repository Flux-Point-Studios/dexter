import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { Minswap } from '../minswap';
import { RequestConfig } from '@app/types';
import { appendSlash } from '@app/utils';
import { logger } from '@app/utils/logger';

/**
 * Minswap API adapter.
 * 
 * Note: Minswap's GraphQL API (as of late 2024) no longer exposes reserve data directly.
 * The API provides tvlInAda and volume24h but not individual asset reserves.
 * This adapter attempts to estimate reserves from TVL when possible.
 * 
 * For accurate reserve data, on-chain discovery via a data provider is recommended.
 * 
 * DECIMALS DISCLAIMER:
 * Asset.decimals values populated by this adapter come from DEX metadata and are
 * NON-AUTHORITATIVE hints only. DEX metadata can be incorrect or change without notice.
 * Consumers should resolve authoritative decimals via Cardano CF token registry,
 * on-chain metadata (CIP-25/CIP-68), or their own decimals resolver for any
 * safety-critical calculations (pricing, slippage, order sizing, etc.).
 */
export class MinswapApi extends BaseApi {

    protected readonly api: AxiosInstance;
    protected readonly dex: Minswap;

    constructor(dex: Minswap, requestConfig: RequestConfig) {
        super();

        this.dex = dex;

        this.api = axios.create({
            timeout: requestConfig.timeout,
            baseURL: `${appendSlash(requestConfig.proxyUrl)}https://monorepo-mainnet-prod.minswap.org/graphql`,
            withCredentials: false,
        });
    }

    liquidityPools(assetA: Token, assetB?: Token): Promise<LiquidityPool[]> {
        // If both tokens provided, use poolsByPairs for efficiency
        if (assetA && assetB) {
            return this.poolsByPairs(assetA, assetB)
                .catch((e: any) => {
                    logger.error('[MinswapApi] poolsByPairs failed', {
                        error: e?.message || String(e),
                        assetA: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                        assetB: assetB === 'lovelace' ? 'ADA' : (assetB as Asset).identifier?.(),
                    });
                    return [];
                });
        }

        const maxPerPage: number = 20;

        const getPaginatedResponse = (page: number): Promise<{ pools: LiquidityPool[]; hasMore: boolean }> => {
            return this.api.post('', {
                operationName: 'PoolsByAsset',
                query: `
                    query PoolsByAsset($input: PoolsByAssetInput!) {
                        poolsByAsset(input: $input) {
                            pools {
                                lpAsset {
                                    currencySymbol
                                    tokenName
                                }
                                poolAssets {
                                    currencySymbol
                                    tokenName
                                    metadata {
                                        decimals
                                    }
                                }
                                type
                                tvlInAda
                                volume24h
                            }
                        }
                    }
                `,
                variables: {
                    input: {
                        asset: {
                            currencySymbol: assetA === 'lovelace' ? '' : assetA.policyId,
                            tokenName: assetA === 'lovelace' ? '' : assetA.nameHex,
                        },
                        limit: maxPerPage,
                        offset: page * maxPerPage,
                    },
                },
            }).then((response: any) => {
                try {
                    const poolsData = response?.data?.data?.poolsByAsset?.pools;

                    if (!Array.isArray(poolsData)) {
                        logger.warn('[MinswapApi] PoolsByAsset response missing pools array', {
                            asset: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                            responseKeys: response?.data ? Object.keys(response.data) : [],
                            dataKeys: response?.data?.data ? Object.keys(response.data.data) : [],
                        });
                        return {
                            pools: [],
                            hasMore: false,
                        };
                    }

                    if (!poolsData.length) {
                        logger.debug('[MinswapApi] poolsByAsset empty', {
                            asset: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                            page,
                        });
                        return {
                            pools: [],
                            hasMore: false,
                        };
                    }

                    const liquidityPools = poolsData
                        .map((pool: any) => {
                            try {
                                return this.liquidityPoolFromResponse(pool);
                            } catch (mapErr: any) {
                                logger.warn('[MinswapApi] Failed to map pool response', {
                                    error: mapErr?.message || String(mapErr),
                                });
                                return undefined;
                            }
                        })
                        .filter((p: LiquidityPool | undefined): p is LiquidityPool => p !== undefined);

                    return {
                        pools: liquidityPools,
                        hasMore: poolsData.length === maxPerPage,
                    };
                } catch (e: any) {
                    logger.error('[MinswapApi] Failed to parse poolsByAsset response', {
                        error: e?.message || String(e),
                        asset: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                        page,
                    });
                    return {
                        pools: [],
                        hasMore: false,
                    };
                }
            }).catch((e: any) => {
                logger.error('[MinswapApi] poolsByAsset request failed', {
                    error: e?.message || String(e),
                    asset: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                    page,
                });
                return {
                    pools: [],
                    hasMore: false,
                };
            });
        };

        const fetchAllPages = async (): Promise<LiquidityPool[]> => {
            const aggregated: LiquidityPool[] = [];
            let page = 0;
            let safetyCounter = 0;

            while (true) {
                const { pools, hasMore } = await getPaginatedResponse(page);
                aggregated.push(...pools);

                if (!hasMore) {
                    break;
                }

                page += 1;
                safetyCounter += 1;

                // Prevent infinite loops if the API ignores offset and keeps returning the same page.
                if (safetyCounter > 50) {
                    logger.warn('[MinswapApi] Pagination guard triggered (more than 50 pages). Stopping to prevent infinite loop.', {
                        asset: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                    });
                    break;
                }
            }

            return aggregated;
        };

        return fetchAllPages();
    }

    private poolsByPairs(assetA: Token, assetB: Token): Promise<LiquidityPool[]> {
        return this.api.post('', {
            operationName: 'PoolsByPairs',
            query: `
                query PoolsByPairs($pairs: [InputPair!]!) {
                    poolsByPairs(pairs: $pairs) {
                        lpAsset {
                            currencySymbol
                            tokenName
                        }
                        poolAssets {
                            currencySymbol
                            tokenName
                            metadata {
                                decimals
                            }
                        }
                        type
                        tvlInAda
                        volume24h
                    }
                }
            `,
            variables: {
                pairs: [{
                    assetA: {
                        currencySymbol: assetA === 'lovelace' ? '' : assetA.policyId,
                        tokenName: assetA === 'lovelace' ? '' : assetA.nameHex,
                    },
                    assetB: {
                        currencySymbol: assetB === 'lovelace' ? '' : assetB.policyId,
                        tokenName: assetB === 'lovelace' ? '' : assetB.nameHex,
                    },
                }],
            },
        }).then((response: any) => {
            try {
                const poolsData = response?.data?.data?.poolsByPairs;

                if (!Array.isArray(poolsData)) {
                    logger.warn('[MinswapApi] PoolsByPairs response not an array', {
                        assetA: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                        assetB: assetB === 'lovelace' ? 'ADA' : (assetB as Asset).identifier?.(),
                        responseKeys: response?.data ? Object.keys(response.data) : [],
                        dataKeys: response?.data?.data ? Object.keys(response.data.data) : [],
                    });
                    return [];
                }

                if (!poolsData.length) {
                    logger.debug('[MinswapApi] poolsByPairs empty', {
                        assetA: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                        assetB: assetB === 'lovelace' ? 'ADA' : (assetB as Asset).identifier?.(),
                    });
                    return [];
                }

                return poolsData
                    .map((pool: any) => {
                        try {
                            return this.liquidityPoolFromResponse(pool);
                        } catch (mapErr: any) {
                            logger.warn('[MinswapApi] Failed to map pool response', {
                                error: mapErr?.message || String(mapErr),
                            });
                            return undefined;
                        }
                    })
                    .filter((p: LiquidityPool | undefined): p is LiquidityPool => p !== undefined);
            } catch (e: any) {
                logger.error('[MinswapApi] Failed to parse poolsByPairs response', {
                    error: e?.message || String(e),
                    assetA: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                    assetB: assetB === 'lovelace' ? 'ADA' : (assetB as Asset).identifier?.(),
                });
                return [];
            }
        }).catch((e: any) => {
            logger.error('[MinswapApi] poolsByPairs request failed', {
                error: e?.message || String(e),
                assetA: assetA === 'lovelace' ? 'ADA' : (assetA as Asset).identifier?.(),
                assetB: assetB === 'lovelace' ? 'ADA' : (assetB as Asset).identifier?.(),
            });
            return [];
        });
    }

    private liquidityPoolFromResponse(poolData: any): LiquidityPool | undefined {
        // Validate required fields
        if (!poolData?.lpAsset || !Array.isArray(poolData?.poolAssets) || poolData.poolAssets.length < 2) {
            logger.debug('[MinswapApi] Pool missing required fields', {
                hasLpAsset: !!poolData?.lpAsset,
                poolAssetsLength: poolData?.poolAssets?.length,
            });
            return undefined;
        }

        const assetAData = poolData.poolAssets[0];
        const assetBData = poolData.poolAssets[1];

        // IMPORTANT: These decimals come from DEX metadata and are NON-AUTHORITATIVE hints.
        // DEX metadata can be incorrect or change without notice. Consumers (e.g., ADAM)
        // should resolve authoritative decimals via Cardano CF token registry, on-chain
        // metadata, or their own decimals resolver for any safety-critical calculations
        // (pricing, slippage, order sizing, etc.).
        const apiDecimalsA = assetAData.metadata?.decimals;
        const apiDecimalsB = assetBData.metadata?.decimals;

        const assetA: Token = assetAData.currencySymbol !== ''
            ? new Asset(assetAData.currencySymbol, assetAData.tokenName, apiDecimalsA ?? 0)
            : 'lovelace';
        const assetB: Token = assetBData.currencySymbol !== ''
            ? new Asset(assetBData.currencySymbol, assetBData.tokenName, apiDecimalsB ?? 0)
            : 'lovelace';

        // Minswap's new API doesn't provide reserves directly
        // We estimate from tvlInAda - this is approximate
        // For accurate data, use on-chain discovery
        const tvlInLovelace = BigInt(poolData.tvlInAda ?? 0);
        
        // If one asset is ADA, we can estimate reserves
        // Otherwise, we set reserves to 0 (indicating data not available)
        let reserveA: bigint = 0n;
        let reserveB: bigint = 0n;
        
        if (assetA === 'lovelace') {
            // Assume roughly half TVL is in ADA for ADA pairs
            reserveA = tvlInLovelace / 2n;
            reserveB = 0n; // Cannot estimate token amount without price
        } else if (assetB === 'lovelace') {
            reserveA = 0n;
            reserveB = tvlInLovelace / 2n;
        }
        // For non-ADA pairs, reserves remain 0

        const liquidityPool: LiquidityPool = new LiquidityPool(
            Minswap.identifier,
            assetA,
            assetB,
            reserveA,
            reserveB,
            '', // Address not provided by API
            this.dex.marketOrderAddress,
            this.dex.limitOrderAddress,
        );

        liquidityPool.lpToken = new Asset(poolData.lpAsset.currencySymbol, poolData.lpAsset.tokenName);
        liquidityPool.identifier = liquidityPool.lpToken.identifier();
        liquidityPool.poolFeePercent = 0.3; // Default Minswap fee
        liquidityPool.totalLpTokens = 0n; // Not provided by API
        
        // Store extra data for reference
        liquidityPool.extra = {
            type: poolData.type,
            tvlInAda: poolData.tvlInAda,
            volume24h: poolData.volume24h,
            reservesEstimated: true, // Flag indicating reserves are estimated
        };

        return liquidityPool;
    }

}
