import { BaseDex } from './base-dex';
import {
    AssetBalance,
    DatumParameters,
    PayToAddress,
    RequestConfig,
    SpendUTxO,
    SwapFee,
    UTxO
} from '@app/types';
import { Asset, Token } from './models/asset';
import { LiquidityPool } from './models/liquidity-pool';
import { BaseDataProvider } from '@providers/data/base-data-provider';
import { correspondingReserves, tokensMatch } from '@app/utils';
import { AddressType, DatumParameterKey } from '@app/constants';
import { DefinitionBuilder } from '@app/definition-builder';
import { CSwapApi } from '@dex/api/cswap-api';
import poolDef from '@dex/definitions/cswap/pool';
import { BaseApi } from '@dex/api/base-api';
import { Script, datumJsonToCbor } from '@lucid-evolution/lucid';

const MIN_POOL_ADA: bigint = 2_000_000n;
const CONTRACT_LOVELACE: bigint = 2_000_000n;
const BATCHER_FEE: bigint = 690_000n;
const PLATFORM_FEE_10K: number = 15;

// Plutus V3 orderbook validator script (from Blockfrost)
const ORDERBOOK_SCRIPT_CBOR: string = '5905fb0101003333232323232323223223223225333008323232323253323300e3001300f37540042646644646464a66602860060022a66602e602c6ea80240085854ccc050c01c0044c8c8c8c94ccc06cc07800801858dd6980e000980e0011bad301a001301637540122a66602866e1d20040011323232323232533301d302000200816375a603c002603c0046eb4c070004c070008dd6980d000980b1baa0091630143754010264646464646464646464646464a66603e601c00226464a666042602060446ea80044c94ccc088c044c08cdd5009099192999812180998129baa00113253330253322323300100100322533302c00114a026644a66605666e3c0080145288998020020009bae302e001302f0013758605460566056605660566056605660566056604e6ea806cdd7181518139baa0021301800114a06601c0204a66604a66ebcc040c09cdd5000980818139baa00313375e6014604e6ea8004c028c09cdd5180518139baa00414a02c601c604a6ea8c038c094dd5000981398121baa01210033026302337540022c646600200201c44a66604a002298103d87a80001332253330243375e601e604c6ea80080544c034cc0a00092f5c0266008008002604e00260500026666004900080600e80d8a99980f98090008991991250375a604a0026eb4c094c098004c084dd500a099191999112999812180998129baa014132325333026323253330283371000e90000980d9980900a1299981499baf3014302b3754002602860566ea80144cc008dd6180718159baa0052337126eb4c010004ccc040dd5980798161baa002375c602a0026eb8c03c0045280992999814992999815180c98159baa0011323300f02523375e602e605c6ea8c044c0b8dd5001000981798161baa00114a06602002c00e20022940c94ccc0a4c060c0a8dd5000899198019bac300f302c375400c466e24dd698028009998089bab3010302d37540046eb8c058004dd71808000981718159baa00114a06601e02800e44646600200200644a66605c00229444cc894ccc0b4c0140084cc0100100045281bac303000130310012302c302d302d001100114a066660100040240460426052604c6ea805058dd698130011bad3026001375a604c604e002604c00260426ea8050c07cdd50099111299981099b89480000104c94ccc088c044c08cdd5000899b8948008ccc020dd5980398121baa300730243754604e60486ea800400c00852819804001802099802801919b8948008ccc020dd5980398121baa30073024375400200600444646600200200644a66604600229404cc894ccc088c0140085288998020020009812800981300091810981100091119299980f1808980f9baa0011480004dd6981198101baa00132533301e3011301f37540022980103d87a8000132330010013756604860426ea8008894ccc08c004530103d87a80001323332225333024337220100062a66604866e3c02000c4c034cc0a0dd400125eb80530103d87a8000133006006001375c60440026eb4c08c004c09c008c094004c8cc004004010894ccc0880045300103d87a80001323332225333023337220100062a66604666e3c02000c4c030cc09cdd300125eb80530103d87a8000133006006001375c60420026eacc088004c098008c090004c0040048894ccc078008530103d87a800013322533301d300c00313006330210024bd70099980280280099b8000348004c080008c084008dd2a400044646600200200644a66603a0022900009991299980e1802801099b80001480084004c07c004cc008008c0800048c06c004dd6180c980d180d0011bac3018001301437540106e1d2000301400130143015001301037540046e1d200216301130120033010002300f002300f001300a375400229309b2b1bac001375c0026eb80055cd2ab9d5573caae7d5d02ba1574498011e581cc11604bc944b14c293b7ea6ad6583f0efedab38bbadebe2f5af4c09b004c0103424342004c01529fd8799fd87a9f581ced97e0a1394724bb7cb94f20acf627abc253694c92b88bf8fb4b7f6fffd8799fd8799fd8799f581cf1feff38edd67922285e28845a207ddd2';

export class CSwap extends BaseDex {

    public static readonly identifier: string = 'CSwap';
    public readonly api: BaseApi;

    /**
     * On-chain constants.
     */
    public readonly orderAddress: string = 'addr1z8d9k3aw6w24eyfjacy809h68dv2rwnpw0arrfau98jk6nhv88awp8sgxk65d6kry0mar3rd0dlkfljz7dv64eu39vfs38yd9p';
    public readonly poolAddress: string = 'addr1z8ke0c9p89rjfwmuh98jpt8ky74uy5mffjft3zlcld9h7ml3lmln3mwk0y3zsh3gs3dzqlwa9rjzrxawkwm4udw9axhs6fuu6e';
    public readonly cancelRedeemer: string = 'd87a80';
    public readonly orderScript: Script = {
        type: 'PlutusV3',
        script: ORDERBOOK_SCRIPT_CBOR,
    };

    constructor(requestConfig: RequestConfig = {}) {
        super();
        this.api = new CSwapApi(this, requestConfig);
    }

    public async liquidityPoolAddresses(): Promise<string[]> {
        return Promise.resolve([this.poolAddress]);
    }

    public async liquidityPools(provider: BaseDataProvider): Promise<LiquidityPool[]> {
        const pools: LiquidityPool[] = [];
        const addresses: string[] = await this.liquidityPoolAddresses();

        for (const address of addresses) {
            const utxos: UTxO[] = await provider.utxos(address);
            for (const utxo of utxos) {
                const pool = await this.liquidityPoolFromUtxo(provider, utxo);
                if (pool) pools.push(pool);
            }
        }
        return pools;
    }

    public async liquidityPoolFromUtxo(provider: BaseDataProvider, utxo: UTxO): Promise<LiquidityPool | undefined> {
        if (!utxo.datumHash) return undefined;

        try {
            const builder: DefinitionBuilder = await (new DefinitionBuilder()).loadDefinition(poolDef);
            const datum = await provider.datumValue(utxo.datumHash);
            const params: DatumParameters = builder.pullParameters(datum as any);

            const tokenAPolicy = (params[DatumParameterKey.PoolAssetAPolicyId] as string) ?? '';
            const tokenAName = (params[DatumParameterKey.PoolAssetAAssetName] as string) ?? '';
            const tokenBPolicy = (params[DatumParameterKey.PoolAssetBPolicyId] as string) ?? '';
            const tokenBName = (params[DatumParameterKey.PoolAssetBAssetName] as string) ?? '';
            const lpFee10k = Number(params[DatumParameterKey.LpFee] ?? 0);

            // Only ADA pairs officially supported for now (ADA is token A)
            if (tokenAPolicy !== '' || tokenAName !== '') {
                return undefined;
            }

            const assetB: Asset = new Asset(tokenBPolicy, tokenBName);

            const adaBalance = utxo.assetBalances.find(a => a.asset === 'lovelace')?.quantity ?? 0n;
            const assetBBalance = utxo.assetBalances.find(a => a.asset !== 'lovelace' && (a.asset as Asset).policyId === tokenBPolicy && (a.asset as Asset).nameHex === tokenBName)?.quantity ?? 0n;

            if (adaBalance === 0n || assetBBalance === 0n) {
                return undefined;
            }

            const reserveAda: bigint = adaBalance - MIN_POOL_ADA >= 0n ? adaBalance - MIN_POOL_ADA : 0n;
            const reserveB: bigint = assetBBalance;

            const pool: LiquidityPool = new LiquidityPool(
                CSwap.identifier,
                'lovelace',
                assetB,
                reserveAda,
                reserveB,
                utxo.address,
                this.orderAddress,
                this.orderAddress,
            );

            pool.poolFeePercent = lpFee10k / 100.0;
            pool.identifier = assetB.identifier(); // Use base asset id

            return pool;
        } catch {
            return undefined;
        }
    }

    public estimatedGive(liquidityPool: LiquidityPool, swapOutToken: Token, swapOutAmount: bigint): bigint {
        const poolFeeMultiplier: bigint = 10000n;
        const poolFeeModifier: bigint = poolFeeMultiplier - BigInt(Math.round((liquidityPool.poolFeePercent / 100) * Number(poolFeeMultiplier)));
        const [reserveOut, reserveIn]: bigint[] = correspondingReserves(liquidityPool, swapOutToken);
        const numerator: bigint = swapOutAmount * reserveIn * poolFeeMultiplier;
        const denominator: bigint = (reserveOut - swapOutAmount) * poolFeeModifier;
        return numerator / denominator;
    }

    public estimatedReceive(liquidityPool: LiquidityPool, swapInToken: Token, swapInAmount: bigint): bigint {
        const poolFeeMultiplier: bigint = 10000n;
        const poolFeeModifier: bigint = poolFeeMultiplier - BigInt(Math.round((liquidityPool.poolFeePercent / 100) * Number(poolFeeMultiplier)));
        const [reserveIn, reserveOut]: bigint[] = correspondingReserves(liquidityPool, swapInToken);
        const numerator: bigint = swapInAmount * reserveOut * poolFeeModifier;
        const denominator: bigint = swapInAmount * poolFeeModifier + reserveIn * poolFeeMultiplier;
        return numerator / denominator;
    }

    public priceImpactPercent(liquidityPool: LiquidityPool, swapInToken: Token, swapInAmount: bigint): number {
        const swapOutTokenDecimals: number = tokensMatch(liquidityPool.assetA, swapInToken)
            ? (liquidityPool.assetB === 'lovelace' ? 6 : liquidityPool.assetB.decimals)
            : (liquidityPool.assetA === 'lovelace' ? 6 : liquidityPool.assetA.decimals);

        const estimatedReceive: bigint = this.estimatedReceive(liquidityPool, swapInToken, swapInAmount);
        const swapPrice: number = (Number(swapInAmount) / 10 ** (swapInToken === 'lovelace' ? 6 : swapInToken.decimals))
            / (Number(estimatedReceive) / 10 ** swapOutTokenDecimals);
        const poolPrice: number = tokensMatch(liquidityPool.assetA, swapInToken)
            ? liquidityPool.price
            : (1 / liquidityPool.price);

        return Math.abs(swapPrice - poolPrice) / ((swapPrice + poolPrice) / 2) * 100;
    }

    public async buildSwapOrder(liquidityPool: LiquidityPool, swapParameters: DatumParameters, spendUtxos: SpendUTxO[] = [], dataProvider?: BaseDataProvider): Promise<PayToAddress[]> {
        const swapInToken: string = (swapParameters[DatumParameterKey.SwapInTokenPolicyId] as string) + (swapParameters[DatumParameterKey.SwapInTokenAssetName] as string);
        const swapOutTokenPolicy = (swapParameters[DatumParameterKey.SwapOutTokenPolicyId] as string) ?? '';
        const swapOutTokenName = (swapParameters[DatumParameterKey.SwapOutTokenAssetName] as string) ?? '';

        const minReceive: bigint = swapParameters[DatumParameterKey.MinReceive] as bigint;

        // Derive slippage10k from estimated receive vs minReceive
        const estimatedReceive: bigint = this.estimatedReceive(
            liquidityPool,
            swapParameters[DatumParameterKey.SwapInTokenPolicyId] ? new Asset(
                swapParameters[DatumParameterKey.SwapInTokenPolicyId] as string,
                swapParameters[DatumParameterKey.SwapInTokenAssetName] as string,
            ) : 'lovelace',
            swapParameters[DatumParameterKey.SwapInAmount] as bigint
        );
        const slippage10k: number = Math.max(0, Math.min(10_000, Math.round((1 - Number(minReceive) / Number(estimatedReceive)) * 10_000)));

        // Apply platform fee on top of minReceive to compute target
        let targetQty: bigint = (minReceive * BigInt(10_000 - PLATFORM_FEE_10K)) / 10_000n;
        if (swapOutTokenPolicy === '' && swapOutTokenName === '') {
            targetQty += CONTRACT_LOVELACE;
        }

        const ownerPkh = (swapParameters[DatumParameterKey.SenderPubKeyHash] as string) ?? '';
        const ownerSkh = (swapParameters[DatumParameterKey.SenderStakingKeyHash] as string) ?? '';

        const orderDatumJson: any = {
            constructor: 0,
            fields: [
                {
                    constructor: 0,
                    fields: [
                        {
                            constructor: 0,
                            fields: [
                                {
                                    bytes: ownerPkh
                                }
                            ]
                        },
                        {
                            constructor: 0,
                            fields: [
                                {
                                    constructor: 0,
                                    fields: [
                                        {
                                            bytes: ownerSkh
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    list: [
                        {
                            list: [
                                { bytes: swapOutTokenPolicy },
                                { bytes: swapOutTokenName },
                                { int: Number(targetQty) }
                            ]
                        },
                        ...(swapOutTokenPolicy !== '' ? [{
                            list: [
                                { bytes: '' },
                                { bytes: '' },
                                { int: Number(CONTRACT_LOVELACE) }
                            ]
                        }] : [])
                    ]
                },
                {
                    list: [
                        {
                            list: [
                                { bytes: swapParameters[DatumParameterKey.SwapInTokenPolicyId] ?? '' },
                                { bytes: swapParameters[DatumParameterKey.SwapInTokenAssetName] ?? '' },
                                { int: 0 }
                            ]
                        }
                    ]
                },
                { constructor: 0, fields: [] }, // order_type Swap
                { int: slippage10k },
                { int: PLATFORM_FEE_10K }
            ]
        };

        const orderPayment: PayToAddress = {
            address: this.orderAddress,
            addressType: AddressType.Contract,
            assetBalances: [
                {
                    asset: 'lovelace',
                    quantity: CONTRACT_LOVELACE + BATCHER_FEE,
                }
            ],
            datum: datumJsonToCbor(orderDatumJson),
            isInlineDatum: true,
            spendUtxos: spendUtxos,
        };

        return [
            this.buildSwapOrderPayment(swapParameters, orderPayment)
        ];
    }

    public async buildCancelSwapOrder(txOutputs: UTxO[], returnAddress: string): Promise<PayToAddress[]> {
        const relevantUtxo: UTxO | undefined = txOutputs.find((utxo: UTxO) => {
            return utxo.address === this.orderAddress;
        });
        if (!relevantUtxo) {
            return Promise.reject('Unable to find relevant UTxO for cancelling the swap order.');
        }
        return [
            {
                address: returnAddress,
                addressType: AddressType.Base,
                assetBalances: relevantUtxo.assetBalances,
                isInlineDatum: false,
                spendUtxos: [{
                    utxo: relevantUtxo,
                    redeemer: this.cancelRedeemer,
                    validator: this.orderScript,
                    signer: returnAddress,
                }],
            }
        ];
    }

    public swapOrderFees(): SwapFee[] {
        return [
            {
                id: 'batcherFee',
                title: 'Batcher Fee',
                description: 'CSWAP batcher fee required by the orderbook.',
                value: BATCHER_FEE,
                isReturned: false,
            },
            {
                id: 'deposit',
                title: 'Deposit ADA',
                description: 'Minimum ADA bundled with the order; returned on completion/cancel.',
                value: CONTRACT_LOVELACE,
                isReturned: true,
            }
        ];
    }
}


