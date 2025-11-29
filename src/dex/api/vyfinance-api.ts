import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { VyFinance } from '../vyfinance';
import { RequestConfig } from '@app/types';
import { appendSlash } from '@app/utils';
import { logger } from '@app/utils/logger';

export class VyfinanceApi extends BaseApi {

    protected readonly api: AxiosInstance;
    protected readonly dex: VyFinance;

    constructor(dex: VyFinance, requestConfig: RequestConfig) {
        super();

        this.dex = dex;
        this.api = axios.create({
            timeout: requestConfig.timeout,
            baseURL: `${appendSlash(requestConfig.proxyUrl)}https://api.vyfi.io`,
            headers: {
                'Content-Type': 'application/json',
            }
        });
    }

    liquidityPools(assetA?: Token, assetB?: Token): Promise<LiquidityPool[]> {
        const assetAId: string = (assetA && assetA !== 'lovelace')
            ? assetA.identifier()
            : 'lovelace';
        let assetBId: string = (assetB && assetB !== 'lovelace')
            ? assetB.identifier()
            : 'lovelace';

        const url: string = assetA && assetB
            ? `/lp?networkId=1&v2=true&tokenAUnit=${assetAId}&tokenBUnit=${assetBId}`
            : '/lp?networkId=1&v2=true';

        return this.api.get(url)
            .then((poolResponse: any) => {
                try {
                    const pools = poolResponse?.data;

                    if (!Array.isArray(pools)) {
                        logger.warn('[VyfinanceApi] pools response not an array', {
                            responseType: typeof pools,
                            responseKeys: pools && typeof pools === 'object' ? Object.keys(pools) : [],
                        });
                        return [];
                    }

                    if (!pools.length) {
                        logger.debug('[VyfinanceApi] pools empty', {
                            assetAId,
                            assetBId,
                        });
                        return [];
                    }

                    return pools
                        .map((pool: any) => {
                            try {
                                // Validate required fields
                                if (!pool?.json || !pool?.['lpPolicyId-assetId']) {
                                    logger.debug('[VyfinanceApi] Pool missing required fields', {
                                        hasJson: !!pool?.json,
                                        hasLpPolicyIdAssetId: !!pool?.['lpPolicyId-assetId'],
                                    });
                                    return undefined;
                                }

                                let poolDetails: any;
                                try {
                                    poolDetails = JSON.parse(pool.json);
                                } catch (parseErr) {
                                    logger.warn('[VyfinanceApi] Failed to parse pool.json', {
                                        error: String(parseErr),
                                    });
                                    return undefined;
                                }

                                if (!poolDetails?.aAsset || !poolDetails?.bAsset) {
                                    logger.debug('[VyfinanceApi] poolDetails missing aAsset or bAsset', {});
                                    return undefined;
                                }

                                const tokenA: Token = poolDetails['aAsset']['tokenName']
                                    ? new Asset(poolDetails['aAsset']['currencySymbol'], Buffer.from(poolDetails['aAsset']['tokenName']).toString('hex'))
                                    : 'lovelace';
                                const tokenB: Token = poolDetails['bAsset']['tokenName']
                                    ? new Asset(poolDetails['bAsset']['currencySymbol'], Buffer.from(poolDetails['bAsset']['tokenName']).toString('hex'))
                                    : 'lovelace';


                                let liquidityPool: LiquidityPool = new LiquidityPool(
                                    VyFinance.identifier,
                                    tokenA,
                                    tokenB,
                                    BigInt(pool['tokenAQuantity'] ?? 0),
                                    BigInt(pool['tokenBQuantity'] ?? 0),
                                    pool['poolValidatorUtxoAddress'] ?? '',
                                    pool['orderValidatorUtxoAddress'] ?? '',
                                    pool['orderValidatorUtxoAddress'] ?? '',
                                );

                                const lpTokenDetails: string[] = pool['lpPolicyId-assetId'].split('-');
                                liquidityPool.lpToken = new Asset(lpTokenDetails[0] ?? '', lpTokenDetails[1] ?? '');
                                
                                const feesSettings = poolDetails['feesSettings'];
                                liquidityPool.poolFeePercent = feesSettings
                                    ? ((feesSettings['barFee'] ?? 0) + (feesSettings['liqFee'] ?? 0)) / 100
                                    : 0;
                                
                                liquidityPool.identifier = liquidityPool.lpToken.identifier();
                                
                                if (poolDetails['mainNFT']) {
                                    liquidityPool.extra.nft = new Asset(
                                        poolDetails['mainNFT']['currencySymbol'] ?? '',
                                        poolDetails['mainNFT']['tokenName'] ?? ''
                                    );
                                }

                                return liquidityPool;
                            } catch (mapErr: any) {
                                logger.warn('[VyfinanceApi] Failed to map pool response', {
                                    error: mapErr?.message || String(mapErr),
                                });
                                return undefined;
                            }
                        })
                        .filter((pool: LiquidityPool | undefined): pool is LiquidityPool => pool !== undefined);
                } catch (e: any) {
                    logger.error('[VyfinanceApi] Error parsing pools response', {
                        error: e?.message || String(e),
                    });
                    return [];
                }
            })
            .catch((e: any) => {
                logger.error('[VyfinanceApi] pools request failed', {
                    error: e?.message || String(e),
                    url,
                });
                return [];
            });
    }

}
