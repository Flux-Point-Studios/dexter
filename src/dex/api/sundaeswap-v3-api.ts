import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { RequestConfig } from '@app/types';
import { appendSlash } from '@app/utils';
import { SundaeSwapV3 } from '@dex/sundaeswap-v3';
import { logger } from '@app/utils/logger';

/**
 * SundaeSwap V3 API adapter.
 * 
 * SundaeSwap V3's API only supports querying by specific token pairs (no bulk listing).
 * When only one asset is provided, we default the second asset to ADA (lovelace).
 * The API returns pools for the given pair, filtered to V3 version only.
 * 
 * DECIMALS DISCLAIMER:
 * Asset.decimals values populated by this adapter come from DEX metadata and are
 * NON-AUTHORITATIVE hints only. Consumers should resolve authoritative decimals via
 * Cardano CF token registry, on-chain metadata, or their own decimals resolver for
 * any safety-critical calculations.
 */
export class SundaeSwapV3Api extends BaseApi {

    protected readonly api: AxiosInstance;
    protected readonly dex: SundaeSwapV3;

    constructor(dex: SundaeSwapV3, requestConfig: RequestConfig) {
        super();

        this.dex = dex;
        this.api = axios.create({
            timeout: requestConfig.timeout,
            baseURL: `${appendSlash(requestConfig.proxyUrl)}https://api.sundae.fi/graphql`,
            headers: {
                'Content-Type': 'application/json',
            }
        });
    }

    /**
     * Fetch liquidity pools for the given token pair.
     * 
     * @param assetA - First token (required)
     * @param assetB - Second token (optional, defaults to ADA/lovelace)
     * @returns Array of V3 liquidity pools matching the pair
     */
    async liquidityPools(assetA: Token, assetB?: Token): Promise<LiquidityPool[]> {
        // Convert tokens to SundaeSwap's Bramble format IDs
        const assetAId: string = this.tokenToSundaeId(assetA);
        
        // Default second asset to ADA if not provided
        const assetBId: string = assetB 
            ? this.tokenToSundaeId(assetB)
            : 'ada.lovelace';

        try {
            const response: any = await this.api.post('', {
                operationName: 'fetchPoolsByPair',
                query: `
                    query fetchPoolsByPair($assetA: ID!, $assetB: ID!) {
                        pools {
                            byPair(assetA: $assetA, assetB: $assetB) {
                                id
                                assetA {
                                    id
                                    policyId
                                    assetName
                                    decimals
                                    ticker
                                    name
                                }
                                assetB {
                                    id
                                    policyId
                                    assetName
                                    decimals
                                    ticker
                                    name
                                }
                                assetLP {
                                    id
                                    policyId
                                    assetName
                                }
                                feesFinalized {
                                    slot
                                }
                                marketOpen {
                                    slot
                                }
                                askFee
                                bidFee
                                current {
                                    quantityA {
                                        quantity
                                    }
                                    quantityB {
                                        quantity
                                    }
                                    quantityLP {
                                        quantity
                                    }
                                    tvl {
                                        quantity
                                    }
                                }
                                version
                            }
                        }
                    }
                `,
                variables: {
                    assetA: assetAId,
                    assetB: assetBId,
                },
            });

            const pools = response?.data?.data?.pools?.byPair;

            if (!Array.isArray(pools)) {
                logger.warn('[SundaeSwapV3Api] pools.byPair not an array or missing', {
                    responseKeys: response?.data ? Object.keys(response.data) : [],
                    dataKeys: response?.data?.data ? Object.keys(response.data.data) : [],
                    poolsKeys: response?.data?.data?.pools ? Object.keys(response.data.data.pools) : [],
                    byPairType: typeof pools,
                    assetA: assetAId,
                    assetB: assetBId,
                });
                return [];
            }

            if (!pools.length) {
                logger.debug('[SundaeSwapV3Api] pools.byPair empty', {
                    assetA: assetAId,
                    assetB: assetBId,
                });
                return [];
            }

            // Filter for V3 pools only
            return pools
                .filter((pool: any) => pool?.version === 'V3')
                .map((pool: any) => {
                    try {
                        return this.liquidityPoolFromResponse(pool);
                    } catch (mapErr: any) {
                        logger.warn('[SundaeSwapV3Api] Failed to map pool response', {
                            error: mapErr?.message || String(mapErr),
                            poolId: pool?.id,
                        });
                        return undefined;
                    }
                })
                .filter((p: LiquidityPool | undefined): p is LiquidityPool => p !== undefined);
        } catch (e: any) {
            logger.error('[SundaeSwapV3Api] fetchPoolsByPair failed', {
                error: e?.message || String(e),
                assetA: assetAId,
                assetB: assetBId,
            });
            return [];
        }
    }

    /**
     * Convert a Token to SundaeSwap's Bramble format ID.
     * Format: "policyId.assetName" or "ada.lovelace" for ADA
     */
    private tokenToSundaeId(token: Token): string {
        if (token === 'lovelace') {
            return 'ada.lovelace';
        }
        return token.identifier('.');
    }

    /**
     * Parse a SundaeSwap pool response into a LiquidityPool object.
     */
    private liquidityPoolFromResponse(pool: any): LiquidityPool | undefined {
        // Validate required fields
        if (!pool?.assetA?.id || !pool?.assetB?.id || !pool?.assetLP?.id || !pool?.current) {
            logger.debug('[SundaeSwapV3Api] Pool missing required fields', {
                hasAssetAId: !!pool?.assetA?.id,
                hasAssetBId: !!pool?.assetB?.id,
                hasAssetLPId: !!pool?.assetLP?.id,
                hasCurrent: !!pool?.current,
            });
            return undefined;
        }

        // IMPORTANT: Decimals from DEX API are NON-AUTHORITATIVE hints.
        // Consumers should resolve authoritative decimals via their own resolver.
        const assetA: Token = pool.assetA.id === 'ada.lovelace'
            ? 'lovelace'
            : Asset.fromIdentifier(pool.assetA.id, pool.assetA.decimals ?? 0);
        
        const assetB: Token = pool.assetB.id === 'ada.lovelace'
            ? 'lovelace'
            : Asset.fromIdentifier(pool.assetB.id, pool.assetB.decimals ?? 0);

        const reserveA = BigInt(pool.current.quantityA?.quantity ?? 0);
        const reserveB = BigInt(pool.current.quantityB?.quantity ?? 0);

        let liquidityPool: LiquidityPool = new LiquidityPool(
            SundaeSwapV3.identifier,
            assetA,
            assetB,
            reserveA,
            reserveB,
            this.dex.poolAddress,
            '', // SundaeSwap V3 uses a batcher model
            '',
        );

        liquidityPool.identifier = pool.id ?? '';
        liquidityPool.lpToken = Asset.fromIdentifier(pool.assetLP.id);
        liquidityPool.totalLpTokens = BigInt(pool.current.quantityLP?.quantity ?? 0);

        // Calculate fee percent from bid/ask fee fractions
        // bidFee is typically [numerator, denominator]
        const bidFee = pool.bidFee;
        if (Array.isArray(bidFee) && bidFee.length >= 2 && bidFee[1] !== 0) {
            liquidityPool.poolFeePercent = Number((bidFee[0] / bidFee[1]) * 100);
        } else {
            liquidityPool.poolFeePercent = 0.3; // Default fee
        }

        // Store extra metadata
        liquidityPool.extra = {
            version: pool.version,
            askFee: pool.askFee,
            bidFee: pool.bidFee,
            tvl: pool.current.tvl?.quantity,
            feesFinalized: pool.feesFinalized?.slot,
            marketOpen: pool.marketOpen?.slot,
        };

        return liquidityPool;
    }

}
