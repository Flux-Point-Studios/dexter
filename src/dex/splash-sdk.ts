import { Splash } from '@dex/splash';
import { LiquidityPool } from './models/liquidity-pool';
import { BaseDataProvider } from '@providers/data/base-data-provider';
import { AddressType, DatumParameterKey } from '@app/constants';
import { DatumParameters, PayToAddress, RequestConfig, SpendUTxO, UTxO } from '@app/types';
import { Asset, Token } from './models/asset';
import { tokensMatch } from '@app/utils';
import {
    AssetInfo,
    Currency,
    Currencies,
    DEFAULT_BATCHER_KEY,
    MINIMUM_COLLATERAL_ADA,
    Network,
    SplashApi as ProtocolSplashApi,
    SplashExplorer,
    getBasePrice,
    getMinMarginalOutput,
    getSplashOperationConfig,
    predictDepositAda,
    spotOrderBeacon,
    spotOrderDatum,
} from '@splashprotocol/sdk';
import { assetInfoFromToken, currenciesToAssetBalances } from '@app/utils/splash-sdk';
import { credentialsToBech32Address } from '@splashprotocol/sdk';

type SplashSdkNetwork = 'mainnet' | 'staging';

const NETWORK_MAP: Record<SplashSdkNetwork, Network> = {
    mainnet: 'mainnet',
    staging: 'preprod',
};

type ExecutorFeeStep = {
    readonly min: string;
    readonly max?: string;
    readonly fee: string;
};

type ExecutorFeeResponse = {
    readonly config: {
        readonly fromAdaSteps: ExecutorFeeStep[];
        readonly fromAssetSteps: ExecutorFeeStep[];
    };
};

export class SplashSdk extends Splash {

    public static readonly identifier: string = 'SplashSdk';
    public readonly name = SplashSdk.identifier;

    private readonly sdkNetwork: SplashSdkNetwork;
    private readonly chainNetwork: Network;
    private readonly explorer: SplashExplorer;
    private readonly splashApi: ReturnType<typeof ProtocolSplashApi>;

    constructor(
        requestConfig: RequestConfig = {},
        network: SplashSdkNetwork = 'mainnet',
        overrides?: {
            explorer?: SplashExplorer;
            splashApi?: ReturnType<typeof ProtocolSplashApi>;
        },
    ) {
        super(requestConfig);
        this.sdkNetwork = network;
        this.chainNetwork = NETWORK_MAP[network] ?? 'mainnet';
        this.explorer = overrides?.explorer ?? SplashExplorer.new(this.chainNetwork);
        this.splashApi = overrides?.splashApi ?? ProtocolSplashApi({ network: this.chainNetwork });
    }

    public override async liquidityPools(provider: BaseDataProvider): Promise<LiquidityPool[]> {
        const pools = await super.liquidityPools(provider);

        return pools.map((pool: LiquidityPool) => {
            pool.dex = SplashSdk.identifier;
            return pool;
        });
    }

    public override async liquidityPoolFromUtxo(
        provider: BaseDataProvider,
        utxo: UTxO,
    ): Promise<LiquidityPool | undefined> {
        const pool = await super.liquidityPoolFromUtxo(provider, utxo);
        if (pool) {
            pool.dex = SplashSdk.identifier;
        }

        return pool;
    }

    public override async buildSwapOrder(
        liquidityPool: LiquidityPool,
        swapParameters: DatumParameters,
        spendUtxos: SpendUTxO[] = [],
        dataProvider?: BaseDataProvider,
    ): Promise<PayToAddress[]> {
        if (!dataProvider) {
            return Promise.reject('Data provider is required.');
        }

        const walletAddress = swapParameters[DatumParameterKey.Address] as string | undefined;
        const senderPkh = swapParameters[DatumParameterKey.SenderPubKeyHash] as string | undefined;
        if (!walletAddress || !senderPkh) {
            return Promise.reject('Wallet details are missing from swap parameters.');
        }

        const swapInAmount = swapParameters[DatumParameterKey.SwapInAmount] as bigint;
        if (!swapInAmount || swapInAmount <= 0n) {
            return Promise.reject('Swap in amount must be provided for Splash SDK swaps.');
        }

        const minReceive = (swapParameters[DatumParameterKey.MinReceive] as bigint) ?? 0n;
        const batcherKey = (swapParameters[DatumParameterKey.Batcher] as string) ?? DEFAULT_BATCHER_KEY;
        const senderStakeKeyHash = swapParameters[DatumParameterKey.SenderStakingKeyHash] as string | undefined;

        const swapInToken = this.resolveToken(
            liquidityPool,
            swapParameters[DatumParameterKey.SwapInTokenPolicyId] as string,
            swapParameters[DatumParameterKey.SwapInTokenAssetName] as string,
        );
        const swapOutToken = this.resolveToken(
            liquidityPool,
            swapParameters[DatumParameterKey.SwapOutTokenPolicyId] as string,
            swapParameters[DatumParameterKey.SwapOutTokenAssetName] as string,
        );

        let walletUtxos: UTxO[] = await dataProvider.utxos(
            walletAddress,
            swapInToken === 'lovelace' ? undefined : swapInToken,
        );
        if (walletUtxos.length === 0) {
            walletUtxos = await dataProvider.utxos(walletAddress);
        }
        const beaconSourceUtxo = walletUtxos[0];
        if (!beaconSourceUtxo) {
            return Promise.reject('Wallet has no available UTxOs for Splash SDK swap.');
        }

        const operationsConfig = await this.getOperationsConfig();
        const orderSettings = operationsConfig.operations.spotOrderV3.settings;

        const inputCurrency = this.toCurrency(swapInToken, swapInAmount);
        const outputAssetInfo = assetInfoFromToken(swapOutToken);

        const slippagePercent = this.deriveSlippagePercent(liquidityPool, swapInToken, swapInAmount, minReceive);
        const DEFAULT_SLIPPAGE_BPS = 100; // 1% default slippage in basis points

        const basePrice = await this.getBasePriceQuote(
            {
                input: inputCurrency,
                outputAsset: outputAssetInfo,
                price: undefined, // Let API calculate price
                slippage: slippagePercent ?? DEFAULT_SLIPPAGE_BPS,
            },
        );

        const orderMaxStepCount = BigInt(orderSettings.maxStepCountMarket);
        const minMarginalOutput = await getMinMarginalOutput({
            basePrice,
            input: inputCurrency,
            stepCount: orderMaxStepCount,
            outputAsset: outputAssetInfo,
        });

        const executorFeeFromTable = await this.fetchExecutorFee(inputCurrency, outputAssetInfo);
        const executorFee = Currency.ada(
            BigInt(executorFeeFromTable ?? orderSettings.executorFee ?? 0),
        );

        const orderStepCost = Currency.ada(BigInt(orderSettings.orderStepCost));
        const worstOrderStepCost = Currency.ada(BigInt(orderSettings.worstOrderStepCost));
        const additionalStepCosts = orderStepCost.multiply(Math.max(0, Number(orderMaxStepCount - 1n)));

        const datumObject = {
            type: '00',
            inputAsset: {
                policyId: inputCurrency.asset.policyId,
                name: this.getAssetNameHex(inputCurrency.asset),
            },
            inputAmount: inputCurrency.amount,
            costPerExStep: worstOrderStepCost.amount,
            minMarginalOutput: minMarginalOutput.amount,
            outputAsset: {
                policyId: outputAssetInfo.policyId,
                name: this.getAssetNameHex(outputAssetInfo),
            },
            price: basePrice.rational,
            executorFee: executorFee.amount,
            address: {
                paymentCredentials: {
                    paymentKeyHash: senderPkh,
                },
                stakeCredentials: senderStakeKeyHash
                    ? {
                        paymentKeyHash: senderStakeKeyHash,
                    }
                    : {},
            },
            cancelPkh: senderPkh,
            permittedExecutors: [batcherKey],
        };

        const beacon = await spotOrderBeacon({
            outputReference: {
                txHash: beaconSourceUtxo.txHash,
                index: BigInt(beaconSourceUtxo.outputIndex),
            },
            orderIndex: 0n,
            datumObject,
        });

        const datum = await spotOrderDatum.serialize({
            ...datumObject,
            beacon,
        });

        const contractAddress = await credentialsToBech32Address(
            this.chainNetwork,
            {
                hash: operationsConfig.operations.spotOrderV3.script,
                type: 'script',
            },
            senderStakeKeyHash
                ? {
                    type: 'pubKey',
                    hash: senderStakeKeyHash,
                }
                : undefined,
        );

        const protocolParams = await this.getProtocolParams();
        const depositAdaForReceive = await this.predictDeposit(
            protocolParams,
            walletAddress,
            Currencies.new([basePrice.getNecessaryQuoteFor(inputCurrency)]),
        );
        const outputValue = Currencies.new([
            inputCurrency,
            worstOrderStepCost,
            additionalStepCosts,
            depositAdaForReceive,
            executorFee,
        ]);

        const depositAdaForOrder = await this.predictDeposit(
            protocolParams,
            contractAddress,
            outputValue,
            datum,
        );

        const combinedDeposit = depositAdaForOrder.plus(depositAdaForReceive);
        const additionalDepositAda = combinedDeposit.gt(MINIMUM_COLLATERAL_ADA)
            ? Currency.ada(0n)
            : MINIMUM_COLLATERAL_ADA.minus(depositAdaForOrder).minus(depositAdaForReceive);

        const totalValue = outputValue.plus([depositAdaForOrder, additionalDepositAda]);
        const totalValueWithoutSwap = totalValue.minus(Currencies.new([inputCurrency]));

        const assetBalances = currenciesToAssetBalances(totalValueWithoutSwap);

        const payment = this.buildSwapOrderPayment(
            swapParameters,
            {
                address: contractAddress,
                addressType: AddressType.Contract,
                assetBalances,
                datum,
                isInlineDatum: true,
                spendUtxos: spendUtxos.concat([{ utxo: beaconSourceUtxo }]),
            },
        );

        return [payment];
    }

    private resolveToken(liquidityPool: LiquidityPool, policyId?: string, assetName?: string): Token {
        if (!policyId) {
            return 'lovelace';
        }

        const candidate = new Asset(policyId, assetName ?? '');

        const matchingPoolAsset = [liquidityPool.assetA, liquidityPool.assetB].find((asset: Token) => {
            if (asset === 'lovelace') {
                return false;
            }
            return tokensMatch(asset, candidate);
        });

        if (matchingPoolAsset && matchingPoolAsset !== 'lovelace') {
            return new Asset(policyId, assetName ?? '', matchingPoolAsset.decimals);
        }

        return candidate;
    }

    private toCurrency(token: Token, amount: bigint): Currency {
        if (token === 'lovelace') {
            return Currency.ada(amount);
        }

        return Currency.new(amount, assetInfoFromToken(token));
    }

    private getAssetNameHex(asset: AssetInfo): string {
        if (asset.isAda()) {
            return '';
        }
        const [, nameHex = ''] = asset.assetId.split('.');

        return nameHex;
    }

    private deriveSlippagePercent(
        liquidityPool: LiquidityPool,
        swapInToken: Token,
        swapInAmount: bigint,
        minReceive: bigint,
    ): number | undefined {
        if (minReceive <= 0n || swapInAmount <= 0n) {
            return undefined;
        }

        const estimatedReceive = this.estimatedReceive(liquidityPool, swapInToken, swapInAmount);
        if (estimatedReceive <= minReceive || estimatedReceive === 0n) {
            return undefined;
        }

        const numerator = (estimatedReceive - minReceive) * 10000n;
        const bps = Number(numerator / estimatedReceive);

        if (!Number.isFinite(bps) || bps <= 0) {
            return undefined;
        }

        return bps / 100;
    }

    protected getOperationsConfig() {
        return getSplashOperationConfig();
    }

    protected getProtocolParams() {
        return this.explorer.getProtocolParams();
    }

    protected getBasePriceQuote(config: Parameters<typeof getBasePrice>[0]) {
        return getBasePrice(config, this.splashApi);
    }

    protected predictDeposit(
        protocolParams: Awaited<ReturnType<typeof this.getProtocolParams>>,
        address: string,
        value: Currencies,
        datum?: string,
    ) {
        return predictDepositAda(protocolParams, { value, address, data: datum });
    }

    private async fetchExecutorFee(input: Currency, outputAsset: AssetInfo): Promise<bigint | undefined> {
        const url = this.chainNetwork === 'mainnet'
            ? 'https://analytics.splash.trade/platform-api/v1/fees-api/distribution/by/pair'
            : 'https://api-test-mainnet.splash.trade/v1/fees-api/distribution/by/pair';

        try {
            const response = await fetch(`${url}?from=${input.asset.assetId}&to=${outputAsset.assetId}`);
            if (!response.ok) {
                return undefined;
            }
            const table: ExecutorFeeResponse = await response.json();
            const steps = input.isAda() ? table.config.fromAdaSteps : table.config.fromAssetSteps;
            const match = steps.find((step) => {
                const min = BigInt(step.min);
                const max = step.max ? BigInt(step.max) : undefined;
                const withinMin = min <= input.amount;
                const withinMax = max ? input.amount < max : true;

                return withinMin && withinMax;
            });

            return match ? BigInt(match.fee) : undefined;
        } catch {
            return undefined;
        }
    }
}

