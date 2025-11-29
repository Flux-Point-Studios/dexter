import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { RequestConfig } from '@app/types';
import { appendSlash } from '@app/utils';
import { Splash } from '@dex/splash';
import { logger } from '@app/utils/logger';

const MAX_INT: bigint = 9_223_372_036_854_775_807n;

export class SplashApi extends BaseApi {

    protected readonly api: AxiosInstance;
    protected readonly dex: Splash;

    constructor(dex: Splash, requestConfig: RequestConfig) {
        super();

        this.dex = dex;

        this.api = axios.create({
            timeout: requestConfig.timeout,
            baseURL: `${appendSlash(requestConfig.proxyUrl)}https://api5.splash.trade/platform-api/v1/`,
            withCredentials: false,
        });
    }

    async liquidityPools(assetA: Token, assetB?: Token): Promise<LiquidityPool[]> {
        try {
            let assets: Record<string, any> = {};
            
            try {
                const assetsResponse = await this.assets();
                assets = assetsResponse?.data?.['tokens'] ?? {};
            } catch (assetsErr: any) {
                logger.warn('[SplashApi] Failed to fetch assets, continuing without decimals', {
                    error: assetsErr?.message || String(assetsErr),
                });
            }

            const response = await this.api.get('/pools/overview?verified=false&duplicated=false');
            const pools = response?.data;

            if (!Array.isArray(pools)) {
                logger.warn('[SplashApi] pools response not an array', {
                    responseType: typeof pools,
                    responseKeys: pools && typeof pools === 'object' ? Object.keys(pools) : [],
                });
                return [];
            }

            if (!pools.length) {
                logger.debug('[SplashApi] pools empty', {});
                return [];
            }

            return pools
                .map((pool: any) => {
                    try {
                        return this.liquidityPoolFromResponse(pool, assets);
                    } catch (mapErr: any) {
                        logger.warn('[SplashApi] Failed to map pool response', {
                            error: mapErr?.message || String(mapErr),
                        });
                        return undefined;
                    }
                })
                .filter((p: LiquidityPool | undefined): p is LiquidityPool => p !== undefined);
        } catch (e: any) {
            logger.error('[SplashApi] liquidityPools failed', {
                error: e?.message || String(e),
            });
            return [];
        }
    }

    private liquidityPoolFromResponse(poolData: any, assets: Record<string, any>): LiquidityPool | undefined {
        // Validate structure
        if (!poolData?.pool) {
            logger.debug('[SplashApi] poolData missing pool property', {});
            return undefined;
        }

        poolData = poolData.pool;

        if (!poolData?.x?.asset || !poolData?.y?.asset || !poolData?.lq?.asset) {
            logger.debug('[SplashApi] pool missing required asset fields', {
                hasX: !!poolData?.x?.asset,
                hasY: !!poolData?.y?.asset,
                hasLq: !!poolData?.lq?.asset,
            });
            return undefined;
        }

        const tokenA: Token = poolData.x.asset === '.'
            ? 'lovelace'
            : (() => {
                const parts = poolData.x.asset.split('.');
                return new Asset(parts[0] ?? '', parts[1] ?? '');
            })();
        const tokenB = poolData.y.asset === '.'
            ? 'lovelace'
            : (() => {
                const parts = poolData.y.asset.split('.');
                return new Asset(parts[0] ?? '', parts[1] ?? '');
            })();

        if (tokenA !== 'lovelace' && tokenA.identifier('.') in assets) {
            tokenA.decimals = assets[tokenA.identifier('.')].decimals ?? 0;
        }
        if (tokenB !== 'lovelace' && tokenB.identifier('.') in assets) {
            tokenB.decimals = assets[tokenB.identifier('.')].decimals ?? 0;
        }

        const liquidityPool: LiquidityPool = new LiquidityPool(
            Splash.identifier,
            tokenA,
            tokenB,
            BigInt(poolData['x']['amount'] ?? 0) - BigInt(poolData['treasuryX'] ?? 0),
            BigInt(poolData['y']['amount'] ?? 0) - BigInt(poolData['treasuryY'] ?? 0),
            '',
            '',
            '',
        );

        const lqAssetParts = poolData['lq']['asset'].split('.');
        const lpTokenPolicyId = lqAssetParts[0] ?? '';
        const lpTokenAssetName = lqAssetParts[1] ?? '';

        liquidityPool.lpToken = new Asset(lpTokenPolicyId, lpTokenAssetName);
        liquidityPool.totalLpTokens = MAX_INT - BigInt(poolData['lq']['amount'] ?? 0);
        liquidityPool.identifier = poolData['id'] ?? liquidityPool.lpToken.identifier();

        return liquidityPool;
    }

    private assets(): Promise<any> {
        return axios.get('https://spectrum.fi/cardano-token-list-v2.json');
    }

}
