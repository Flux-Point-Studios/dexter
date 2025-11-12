import { BaseApi } from './base-api';
import { Asset, Token } from '../models/asset';
import { LiquidityPool } from '../models/liquidity-pool';
import axios, { AxiosInstance } from 'axios';
import { SaturnSwap } from '../saturnswap';
import { RequestConfig } from '@app/types';
import { appendSlash } from '@app/utils';

/**
 * SaturnSwap API implementation (REST)
 *
 * Note: SaturnSwap is a limit-order/aggregator style DEX. We expose orderbook and
 * transaction helpers; the liquidityPools method fabricates a minimal pool-like
 * object for Dexter's common interfaces when both tokens are provided.
 */
export class SaturnSwapApi extends BaseApi {

    protected readonly api: AxiosInstance;
    protected readonly dex: SaturnSwap;

    constructor(dex: SaturnSwap, requestConfig: RequestConfig) {
        super();

        this.dex = dex;

        const baseEnv = (typeof process !== 'undefined' && (process as any).env)
            ? ((process as any).env.SATURN_API_BASE_URL as string | undefined)
            : undefined;

        const baseUrl = baseEnv && baseEnv.length > 0
            ? baseEnv
            : 'https://api.saturnswap.xyz';

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        const key = (typeof process !== 'undefined' && (process as any).env)
            ? ((((process as any).env.SATURN_API_KEY || (process as any).env.SATURN_API_TOKEN) as string | undefined))
            : undefined;

        if (key && key.length > 0) {
            headers['Authorization'] = key.startsWith('Bearer ') ? key : `Bearer ${key}`;
        }

        this.api = axios.create({
            timeout: requestConfig.timeout,
            baseURL: `${appendSlash(requestConfig.proxyUrl)}${baseUrl}`,
            headers,
            withCredentials: false,
        });
    }

    // ===== Public REST methods =====

    async assets(): Promise<AggregatorAssetDTO[]> {
        const { data } = await this.api.get<AggregatorAssetsResponseDTO>('/v1/aggregator/assets');
        return data.assets ?? [];
    }

    async orderbook(assetA: Token, assetB: Token): Promise<AggregatorOrderbookResponseDTO> {
        const params: Record<string, string> = {};
        if (assetA !== 'lovelace') {
            const a = assetA as Asset;
            params.asset = `${a.policyId}.${a.assetName}`;
        } else {
            params.asset = '';
        }
        params.address = this.dex.orderAddress;
        const { data } = await this.api.get<AggregatorOrderbookResponseDTO>('/v1/aggregator/orderbook', { params });
        return data;
    }

    async createOrderTransactionSimple(input: SimpleCreateInputDTO): Promise<SimpleCreatePayloadDTO> {
        const { data } = await this.api.post<SimpleCreatePayloadDTO>('/v1/aggregator/simple/create-order-transaction', input);
        return data;
    }

    async submitOrderTransactionSimple(input: SimpleSubmitInputDTO): Promise<SimpleSubmitPayloadDTO> {
        const { data } = await this.api.post<SimpleSubmitPayloadDTO>('/v1/aggregator/simple/submit-order-transaction', input);
        return data;
    }

    async signOrderTransactionAdvanced(input: AdvancedSignInputDTO): Promise<AdvancedSignPayloadDTO> {
        const { data } = await this.api.post<AdvancedSignPayloadDTO>('/v1/aggregator/advanced/sign-order-transaction', input);
        return data;
    }

    // ===== Additional high-level helpers (by asset) =====
    async quoteByAsset(input: QuoteRequest): Promise<QuoteResponse> {
        const { data } = await this.api.post<QuoteResponse>('/v1/aggregator/quote', input);
        return data;
    }

    async createOrderTransactionFromAsset(input: CreateFromAssetInput): Promise<SimpleCreatePayloadDTO> {
        const { data } = await this.api.post<SimpleCreatePayloadDTO>('/v1/aggregator/simple/create-from-asset', input);
        return data;
    }

    // ===== AMM facade (new) =====
    async getAmmPools(): Promise<AmmPoolDTO[]> {
        const { data } = await this.api.get<AmmPoolsResponse>('/v1/aggregator/pools');
        return data?.pools ?? [];
    }

    async getAmmPoolById(poolId: string): Promise<AmmPoolById | undefined> {
        const { data } = await this.api.get<AmmPoolById>('/v1/aggregator/pools/by-pool', { params: { id: poolId } as any });
        return data;
    }

    async ammQuote(req: AmmQuoteRequest): Promise<AmmQuoteResponse> {
        const { data } = await this.api.post<AmmQuoteResponse>('/v1/aggregator/amm/quote', req);
        return data;
    }

    async ammBuildOrder(req: AmmBuildRequest): Promise<AmmBuildResponse> {
        const { data } = await this.api.post<AmmBuildResponse>('/v1/aggregator/amm/build-order', req);
        return data;
    }

    // ===== Dexter compatibility: fabricate a minimal pool from orderbook =====
    async liquidityPools(assetA?: Token, assetB?: Token): Promise<LiquidityPool[]> {
        if (!assetA || !assetB) return [];

        const ob = await this.orderbook(assetA, assetB);

        const reserveA = this.approximateReserveFor(assetA, ob.asks, ob.bids);
        const reserveB = this.approximateReserveFor(assetB, ob.asks, ob.bids);

        const pool = new LiquidityPool(
            SaturnSwap.identifier,
            assetA,
            assetB,
            reserveA,
            reserveB,
            this.dex.poolAddress,
            this.dex.orderAddress,
            this.dex.orderAddress,
        );

        pool.poolFeePercent = 0.3;
        pool.identifier = `${this.dex.orderAddress}:${this.assetKey(assetA)}-${this.assetKey(assetB)}`;
        pool.extra = { orderbook: { asks: ob.asks ?? [], bids: ob.bids ?? [] } };

        return [pool];
    }

    // ===== Internals =====

    private static readonly DEFAULT_UNIT_MULTIPLIER: bigint = 1_000_000n;

    private assetKey(token: Token): string {
        return token === 'lovelace'
            ? 'lovelace'
            : `${(token as Asset).policyId}.${(token as Asset).assetName}`;
    }

    private approximateReserveFor(target: Token, asks?: AggregatorOrderDTO[], bids?: AggregatorOrderDTO[]): bigint {
        const isAda = target === 'lovelace';
        const policyId = isAda ? '' : (target as Asset).policyId;
        const assetName = isAda ? '' : (target as Asset).assetName;

        const orders = [...(asks ?? []), ...(bids ?? [])];
        let total = 0;

        for (const o of orders) {
            const matchA = (o.assetA.policyId ?? '') === policyId && (o.assetA.assetName ?? '') === assetName;
            const matchB = (o.assetB.policyId ?? '') === policyId && (o.assetB.assetName ?? '') === assetName;

            if (matchA) total += o.sell_amount;
            if (matchB) total += o.buy_amount;
        }

        return BigInt(Math.floor(total)) * SaturnSwapApi.DEFAULT_UNIT_MULTIPLIER;
    }
}

// ===== Types =====

// AMM facade types
export interface AmmPoolDTO {
    id: string;                   // "<unitA>-<unitB>"
    assetA: { unit: string };
    assetB: { unit: string };
    reserveA: string | number;
    reserveB: string | number;
    feePercent: number;
}

export interface AmmPoolsResponse {
    pools: AmmPoolDTO[];
}

export interface AmmPoolById {
    id: string;
    bestBid?: number;
    bestAsk?: number;
    buildable?: {
        marketBuyFromAda?: boolean;
        marketSellToAda?: boolean;
    };
    snapshotAt?: string;
}

export interface AmmQuoteRequest {
    poolId: string;
    direction: 'in' | 'out';
    swapInAmount?: number;
    swapOutAmount?: number;
    slippageBps?: number;
}

export interface AmmQuoteResponse {
    expectedIn?: string;
    expectedOut?: string;
    minReceive?: string;
    pool?: AmmPoolDTO;
    snapshotAt?: string;
}

export interface AmmBuildRequest extends AmmQuoteRequest {
    changeAddress: string;
}

export interface AmmBuildResponse {
    unsignedCborHex: string;
    minReceive: string;
    expiry: number;
}

interface AggregatorOrderbookAssetDTO {
    policyId?: string | null;
    assetName?: string | null;
}

interface AggregatorOrderDTO {
    assetA: AggregatorOrderbookAssetDTO;
    assetB: AggregatorOrderbookAssetDTO;
    price: number;
    sell_amount: number;
    buy_amount: number;
    type?: string | null;
}

interface AggregatorOrderbookResponseDTO {
    asks?: AggregatorOrderDTO[];
    bids?: AggregatorOrderDTO[];
}

interface AggregatorAssetDTO {
    poolId?: string | null;
    policyId?: string | null;
    assetName?: string | null;
    lpFeePercent: number;
    assetRoyalty?: {
        tokenProjectAddress?: string | null;
        royaltyPercent: number;
    } | null;
}

interface AggregatorAssetsResponseDTO {
    assets?: AggregatorAssetDTO[];
}

interface SimpleCreateInputDTO {
    paymentAddress?: string | null;
    limitOrderComponents?: Array<{
        poolId?: string | null;
        tokenAmountSell: number;
        tokenAmountBuy: number;
        limitOrderType: number;
        version: number;
    }> | null;
    marketOrderComponents?: Array<{
        poolId?: string | null;
        tokenAmountSell: number;
        tokenAmountBuy: number;
        marketOrderType: number;
        slippage?: number | null;
        version: number;
    }> | null;
    cancelComponents?: Array<{
        poolUtxoId?: string | null;
        version: number;
    }> | null;
}

interface SuccessTransaction {
    transactionId?: string | null;
    hexTransaction?: string | null;
}

interface FailTransaction {
    error?: { message?: string | null; code?: string | null; link?: string | null } | null;
}

interface SimpleCreatePayloadDTO {
    successTransactions?: SuccessTransaction[] | null;
    failTransactions?: FailTransaction[] | null;
    error?: { message?: string | null; code?: string | null; link?: string | null } | null;
}

interface SimpleSubmitInputDTO {
    paymentAddress?: string | null;
    successTransactions?: SuccessTransaction[] | null;
}

interface SimpleSubmitPayloadDTO {
    transactionIds?: string[] | null;
    error?: { message?: string | null; code?: string | null; link?: string | null } | null;
}

interface AdvancedSignInputDTO {
    paymentAddress?: string | null;
    transactionIds?: string[] | null;
    hexTransactions?: string[] | null;
    submit: boolean;
    returnSignedHex: boolean;
}

interface SignatureTransaction {
    publicKey?: string | null;
    signature?: string | null;
    cbor?: string | null;
    witnessCbor?: string | null;
}

interface AdvancedSignPayloadDTO {
    successTransactions?: SuccessTransaction[] | null;
    signatures?: SignatureTransaction[] | null;
    error?: { message?: string | null; code?: string | null; link?: string | null } | null;
} 

// Quote by asset request/response
export interface QuoteRequest {
    asset: string;             // concatenated policyId + assetNameHex ('' for ADA)
    direction: number;         // 3 MarketBuy ADA->token, 4 MarketSell token->ADA
    tokenAmountSell: number;   // display units
    tokenAmountBuy: number;    // display units, optional; use 0 when slippage=null
    slippage: number | null;   // percent (e.g., 0.5) or null
}

export interface QuoteResponse {
    buildable: boolean;
    reason?: string | null;
    expectedBuy?: number | null;
    minReceive?: number | null;
    selectedPoolId?: string | null;
    bestAsk?: number | null;
    bestBid?: number | null;
}

// Create from asset input
export interface CreateFromAssetInput extends QuoteRequest {
    paymentAddress: string;
}