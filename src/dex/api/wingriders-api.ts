import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { RequestConfig } from '@app/types';
import { WingRiders } from '@dex/wingriders';
import { appendSlash } from '@app/utils';
import { logger } from '@app/utils/logger';

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
        return this.api.post('', {
            operationName: 'LiquidityPoolsWithMarketData',
            query: `
                query LiquidityPoolsWithMarketData($input: PoolsWithMarketdataInput) {
                    poolsWithMarketdata(input: $input) {
                        ...LiquidityPoolFragment
                    }
                }
                fragment LiquidityPoolFragment on PoolWithMarketdata {
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
            `,
            variables: {
                input: {
                    sort: true
                },
            },
        }).then((response: any) => {
            try {
                const pools = response?.data?.data?.poolsWithMarketdata;

                if (!Array.isArray(pools)) {
                    logger.warn('[WingRidersApi] poolsWithMarketdata not an array or missing', {
                        responseKeys: response?.data ? Object.keys(response.data) : [],
                        dataKeys: response?.data?.data ? Object.keys(response.data.data) : [],
                        poolsType: typeof pools,
                    });
                    return [];
                }

                if (!pools.length) {
                    logger.debug('[WingRidersApi] poolsWithMarketdata empty', {});
                    return [];
                }

                return pools
                    .map((pool: any) => {
                        try {
                            // Validate required fields exist
                            if (!pool?.tokenA || !pool?.tokenB || !pool?.issuedShareToken || !pool?._utxo?.address) {
                                logger.debug('[WingRidersApi] Pool missing required fields', {
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

                            let liquidityPool: LiquidityPool = new LiquidityPool(
                                WingRiders.identifier,
                                tokenA,
                                tokenB,
                                BigInt(pool.tokenA.quantity ?? 0) - BigInt(pool.treasuryA ?? 0),
                                BigInt(pool.tokenB.quantity ?? 0) - BigInt(pool.treasuryB ?? 0),
                                pool._utxo.address,
                                this.dex.orderAddress,
                                this.dex.orderAddress,
                            );

                            liquidityPool.lpToken = new Asset(pool.issuedShareToken.policyId, pool.issuedShareToken.assetName);
                            liquidityPool.poolFeePercent = 0.35;
                            liquidityPool.identifier = liquidityPool.lpToken.identifier();
                            liquidityPool.totalLpTokens = BigInt(pool.issuedShareToken.quantity ?? 0);

                            return liquidityPool;
                        } catch (mapErr: any) {
                            logger.warn('[WingRidersApi] Failed to map pool response', {
                                error: mapErr?.message || String(mapErr),
                            });
                            return undefined;
                        }
                    })
                    .filter((pool: LiquidityPool | undefined): pool is LiquidityPool => pool !== undefined);
            } catch (e: any) {
                logger.error('[WingRidersApi] Error parsing poolsWithMarketdata response', {
                    error: e?.message || String(e),
                });
                return [];
            }
        }).catch((e: any) => {
            logger.error('[WingRidersApi] poolsWithMarketdata request failed', {
                error: e?.message || String(e),
            });
            return [];
        });
    }

}
