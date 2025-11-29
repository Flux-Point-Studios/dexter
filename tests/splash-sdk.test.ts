import {
    AddressType,
    Asset,
    BaseDataProvider,
    DatumParameterKey,
    DatumParameters,
    LiquidityPool,
    MockDataProvider,
    PayToAddress,
    SplashSdk,
    UTxO,
} from '../src';
import { Currency, Currencies, Price } from '@splashprotocol/sdk';

class TestDataProvider extends MockDataProvider {

    constructor(private readonly utxo: UTxO) {
        super();
    }

    public override async utxos(): Promise<UTxO[]> {
        return [this.utxo];
    }
}

class TestSplashSdk extends SplashSdk {

    constructor() {
        super({}, 'mainnet');
    }

    protected override getOperationsConfig() {
        return Promise.resolve({
            operations: {
                spotOrderV3: {
                    script: '1'.repeat(56),
                    settings: {
                        orderStepCost: 400000,
                        worstOrderStepCost: 900000,
                        maxStepCount: 10,
                        maxStepCountMarket: 10,
                        executorFee: 2_000_000,
                    },
                },
            },
        } as any);
    }

    protected override getProtocolParams() {
        return Promise.resolve({
            network: 'mainnet',
            protocolVersion: { major: 8, minor: 0 },
            collateralPercentage: 150,
            maxCollateralInputs: 3,
            maxTxExecutionUnits: { memory: 10n ** 6n, steps: 10n ** 6n },
            executionUnitPrices: { priceMemory: 0.001, priceSteps: 0.001 },
            costModels: {},
            coinsPerUtxoByte: 4310n,
            maxTxSize: 16384,
            poolDeposit: 500000000n,
            keyDeposit: 2000000n,
            txFeeFixed: 155381n,
            txFeePerByte: 44n,
            minUtxoValue: 1000000n,
            minUTxOValue: 1000000n,
            maxValueSize: 5000,
        });
    }

    protected override getBasePriceQuote(config: Parameters<SplashSdk['getBasePriceQuote']>[0]) {
        return Promise.resolve(
            Price.new({
                base: config.input.asset,
                quote: config.outputAsset,
                value: '1',
            }),
        );
    }

    protected override predictDeposit(
        _protocolParams: Awaited<ReturnType<SplashSdk['getProtocolParams']>>,
        _address: string,
        _value: Currencies,
    ): ReturnType<SplashSdk['predictDeposit']> {
        return Promise.resolve(Currency.ada(2_000_000n));
    }
}

describe('SplashSdk', () => {

    const policy = 'f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880';
    const asset = new Asset(policy, '534c415348', 6);

    const liquidityPool = new LiquidityPool(
        SplashSdk.identifier,
        'lovelace',
        asset,
        10_000_000_000000n,
        5_000_000_000n,
        'addr_pool',
    );

    const walletAddress = 'addr1q9d6g9ccl7z0rkw3x0ceg0dp2hceh5rpyfh0gtn3jat3zh0v4k0dzqfjrq9vek3cxr92cus0x32f3ldm34rtqlh6jzwsccw6r2';
    const walletUtxo: UTxO = {
        txHash: 'a'.repeat(64),
        address: walletAddress,
        datumHash: '',
        outputIndex: 0,
        assetBalances: [
            { asset: 'lovelace', quantity: 5_000_000n },
            { asset, quantity: 1_000_000n },
        ],
    };

    const swapParameters: DatumParameters = {
        [DatumParameterKey.Address]: walletAddress,
        [DatumParameterKey.SenderPubKeyHash]: 'a'.repeat(56),
        [DatumParameterKey.SenderStakingKeyHash]: 'b'.repeat(56),
        [DatumParameterKey.ReceiverPubKeyHash]: 'a'.repeat(56),
        [DatumParameterKey.ReceiverStakingKeyHash]: 'b'.repeat(56),
        [DatumParameterKey.SwapInAmount]: 2_000_000n,
        [DatumParameterKey.MinReceive]: 1_700_000n,
        [DatumParameterKey.SwapInTokenPolicyId]: '',
        [DatumParameterKey.SwapInTokenAssetName]: '',
        [DatumParameterKey.SwapOutTokenPolicyId]: asset.policyId,
        [DatumParameterKey.SwapOutTokenAssetName]: asset.nameHex,
    };

    it('builds Splash SDK swap order using protocol helpers', async () => {
        const sdk = new TestSplashSdk();
        const dataProvider: BaseDataProvider = new TestDataProvider(walletUtxo);

        const payments: PayToAddress[] = await sdk.buildSwapOrder(
            liquidityPool,
            swapParameters,
            [],
            dataProvider,
        );

        expect(payments).toHaveLength(1);
        const payment = payments[0];
        expect(payment.addressType).toBe(AddressType.Contract);
        expect(payment.isInlineDatum).toBe(true);
        expect(typeof payment.datum).toBe('string');
        const lovelaceBalance = payment.assetBalances.find((balance) => balance.asset === 'lovelace');
        expect(lovelaceBalance?.quantity).toBeGreaterThan(2_000_000n);
        expect(payment.spendUtxos?.length).toBe(1);
        expect(payment.spendUtxos?.[0].utxo.txHash).toBe(walletUtxo.txHash);
    });

});

