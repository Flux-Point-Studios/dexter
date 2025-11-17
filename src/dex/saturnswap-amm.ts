import { BaseDex } from './base-dex';
import { LiquidityPool } from './models/liquidity-pool';
import { Token, Asset } from './models/asset';
import { BaseDataProvider } from '@providers/data/base-data-provider';
import { RequestConfig, PayToAddress, SwapFee, UTxO } from '@app/types';
import { BaseApi } from '@dex/api/base-api';
import { SaturnSwapApi, AmmPoolDTO } from './api/saturnswap-api';
import { correspondingReserves } from '@app/utils';
import { BaseWalletProvider } from '@providers/wallet/base-wallet-provider';

export class SaturnSwapAMM extends BaseDex {

    public static readonly identifier: string = 'SaturnSwap-AMM';
    public readonly api: BaseApi;

    constructor(requestConfig: RequestConfig = {}) {
        super();
        this.api = new SaturnSwapApi(this as any, requestConfig);
    }

    public async liquidityPoolAddresses(_provider?: BaseDataProvider): Promise<string[]> {
        return [];
    }

    public async liquidityPools(_provider?: BaseDataProvider): Promise<LiquidityPool[]> {
        const pools = await (this.api as SaturnSwapApi).getAmmPools();
        return pools.map((p: AmmPoolDTO) => this.poolFromDTO(p)).filter(Boolean) as LiquidityPool[];
    }

    public async liquidityPoolFromUtxo(_provider: BaseDataProvider): Promise<LiquidityPool | undefined> {
        return undefined;
    }

    public estimatedGive(liquidityPool: LiquidityPool, swapOutToken: Token, swapOutAmount: bigint): bigint {
        const feeFraction = liquidityPool.poolFeePercent / 100;
        const feeBps = Math.round(feeFraction * 10_000);
        const feeMul = 10_000n - BigInt(feeBps);
        const [reserveOut, reserveIn] = correspondingReserves(liquidityPool, swapOutToken);
        const numerator = swapOutAmount * reserveIn * 10_000n;
        const denominator = (reserveOut - swapOutAmount) * feeMul;
        return (numerator + denominator - 1n) / denominator;
    }

    public estimatedReceive(liquidityPool: LiquidityPool, swapInToken: Token, swapInAmount: bigint): bigint {
        const feeFraction = liquidityPool.poolFeePercent / 100;
        const feeBps = Math.round(feeFraction * 10_000);
        const feeMul = 10_000n - BigInt(feeBps);
        const [reserveIn, reserveOut] = correspondingReserves(liquidityPool, swapInToken);
        const numerator = swapInAmount * feeMul * reserveOut;
        const denominator = reserveIn * 10_000n + swapInAmount * feeMul;
        return numerator / denominator;
    }

    public priceImpactPercent(liquidityPool: LiquidityPool, swapInToken: Token, swapInAmount: bigint): number {
        const [reserveIn, reserveOut] = correspondingReserves(liquidityPool, swapInToken);
        if (swapInAmount === 0n || reserveIn === 0n || reserveOut === 0n) return 0;
        const p0 = Number(reserveOut) / Number(reserveIn);
        const out = this.estimatedReceive(liquidityPool, swapInToken, swapInAmount);
        const p1 = Number(reserveOut - out) / Number(reserveIn + swapInAmount);
        return ((p0 - p1) / p0) * 100;
    }

    public async buildSwapOrder(): Promise<PayToAddress[]> {
        throw new Error('SaturnSwap-AMM: use ammBuildOrder (createAmmUnsignedHex) and sign locally instead.');
    }

    public async buildCancelSwapOrder(_txOutputs: UTxO[], _returnAddress: string): Promise<PayToAddress[]> {
        throw new Error('SaturnSwap-AMM: cancel via CLOB provider if needed.');
    }

    public swapOrderFees(): SwapFee[] {
        return [];
    }

    private poolFromDTO(p: AmmPoolDTO): LiquidityPool | undefined {
        // Backend returns assetA/assetB as strings, not { unit: string }
        const unitA = typeof p.assetA === 'string' ? p.assetA : p.assetA?.unit;
        const unitB = typeof p.assetB === 'string' ? p.assetB : p.assetB?.unit;
        const a = this.unitToToken(unitA);
        const b = this.unitToToken(unitB);
        const reserveA = BigInt(p.reserveA ?? 0);
        const reserveB = BigInt(p.reserveB ?? 0);
        const lp = new LiquidityPool(SaturnSwapAMM.identifier, a, b, reserveA, reserveB, '');
        lp.poolFeePercent = p.feePercent ?? 0;
        // Backend provides both id and poolId (same value - the real poolId)
        lp.identifier = p.poolId ?? p.id; // Use poolId if available, fallback to id (backward compatibility)
        return lp;
    }

    private unitToToken(unit: string): Token {
        if (!unit || unit === 'lovelace') return 'lovelace';
        const [policyId, assetName] = unit.split('.');
        return new Asset(policyId, assetName);
    }

    public async createAmmUnsignedHex(poolId: string, direction: 'in' | 'out', swapAmount: number, changeAddress: string, slippageBps?: number, partnerAddress?: string): Promise<string> {
        const api = this.api as SaturnSwapApi;
        // poolId is the backend's real poolId (no fabrication - use directly)
        const req: any = direction === 'in'
            ? { poolId, direction, swapInAmount: swapAmount, slippageBps, changeAddress, partnerAddress }
            : { poolId, direction, swapOutAmount: swapAmount, slippageBps, changeAddress, partnerAddress };
        const res = await api.ammBuildOrder(req);
        return res.unsignedCborHex;
    }

    /**
     * Convenience: build via AMM endpoint, then sign+submit locally.
     */
    public async buildAmmSignSubmit(args: {
        poolId: string;
        direction: 'in' | 'out';
        swapAmount: number;           // on-chain units
        changeAddress: string;        // bech32
        slippageBps?: number;
        partnerAddress?: string;
    }, wallet?: BaseWalletProvider): Promise<string> {
        if (!wallet) throw new Error('Wallet provider is required for local signing.');
        const hex = await this.createAmmUnsignedHex(args.poolId, args.direction, args.swapAmount, args.changeAddress, args.slippageBps, args.partnerAddress);
        if (!hex) throw new Error('AMM build did not return an unsigned CBOR hex.');
        const tx = wallet.newTransactionFromHex(hex);
        await tx.sign();
        await tx.submit();
        return tx.hash;
    }
}


