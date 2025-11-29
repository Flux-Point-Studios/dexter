import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { RequestConfig } from '@app/types';
import { appendSlash } from '@app/utils';
import { SundaeSwapV3 } from '@dex/sundaeswap-v3';
import { logger } from '@app/utils/logger';

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

    async liquidityPools(assetA: Token, assetB?: Token): Promise<LiquidityPool[]> {
        const assetAId: string = (assetA === 'lovelace')
            ? 'ada.lovelace'
            : assetA.identifier('.');
        const assetBId: string = (assetB && assetB !== 'lovelace')
            ? assetB.identifier('.')
            : 'ada.lovelace';
        const assets: string[] = [assetAId, assetBId];

        try {
            const response: any = await this.api.post('', {
                operationName: 'fetchPoolsByPair',
                query: `query fetchPoolsByPair($assetA: ID!, $assetB: ID!) {\n  pools {\n    byPair(assetA: $assetA, assetB: $assetB) {\n      ...PoolBrambleFragment\n    }\n  }\n}\n\nfragment PoolBrambleFragment on Pool {\n  id\n  assetA {\n    ...AssetBrambleFragment\n  }\n  assetB {\n    ...AssetBrambleFragment\n  }\n  assetLP {\n    ...AssetBrambleFragment\n  }\n  feesFinalized {\n    slot\n  }\n  marketOpen {\n    slot\n  }\n  askFee\n  bidFee\n  feeManagerId\n  current {\n    quantityA {\n      quantity\n    }\n    quantityB {\n      quantity\n    }\n    quantityLP {\n      quantity\n    }\n    tvl {\n      quantity\n    }\n  }\n  version\n}\n\nfragment AssetBrambleFragment on Asset {\n  id\n  policyId\n  description\n  dateListed {\n    format\n  }\n  decimals\n  ticker\n  name\n  logo\n  assetName\n  metadata {\n    ... on OnChainLabel20 {\n      __typename\n    }\n    ... on OnChainLabel721 {\n      __typename\n    }\n    ... on CardanoTokenRegistry {\n      __typename\n    }\n  }\n}`,
                variables: {
                    assetA: assets[0],
                    assetB: assets[1],
                },
            });

            const pools = response?.data?.data?.pools?.byPair;

            if (!Array.isArray(pools)) {
                logger.warn('[SundaeSwapV3Api] pools.byPair not an array or missing', {
                    responseKeys: response?.data ? Object.keys(response.data) : [],
                    dataKeys: response?.data?.data ? Object.keys(response.data.data) : [],
                    poolsKeys: response?.data?.data?.pools ? Object.keys(response.data.data.pools) : [],
                    byPairType: typeof pools,
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

            return pools
                .filter((pool: any) => pool?.version === 'V3')
                .map((pool: any) => {
                    try {
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

                        let liquidityPool: LiquidityPool = new LiquidityPool(
                            SundaeSwapV3.identifier,
                            pool.assetA.id === 'ada.lovelace'
                                ? 'lovelace'
                                : Asset.fromIdentifier(pool.assetA.id, pool.assetA.decimals),
                            pool.assetB.id === 'ada.lovelace'
                                ? 'lovelace'
                                : Asset.fromIdentifier(pool.assetB.id, pool.assetB.decimals),
                            BigInt(pool.current.quantityA?.quantity ?? 0),
                            BigInt(pool.current.quantityB?.quantity ?? 0),
                            this.dex.poolAddress,
                            '',
                            '',
                        );

                        liquidityPool.identifier = pool.id ?? '';
                        liquidityPool.lpToken = Asset.fromIdentifier(pool.assetLP.id);

                        // Safely calculate pool fee
                        const bidFee = pool.bidFee;
                        if (Array.isArray(bidFee) && bidFee.length >= 2 && bidFee[1] !== 0) {
                            liquidityPool.poolFeePercent = Number((bidFee[0] / bidFee[1]) * 100);
                        } else {
                            liquidityPool.poolFeePercent = 0;
                        }

                        liquidityPool.totalLpTokens = BigInt(pool.current.quantityLP?.quantity ?? 0);

                        return liquidityPool;
                    } catch (mapErr: any) {
                        logger.warn('[SundaeSwapV3Api] Failed to map pool response', {
                            error: mapErr?.message || String(mapErr),
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

}
