import {
    Dexter,
    LiquidityPool,
    MockDataProvider,
    SwapRequest,
    Asset,
    MockWalletProvider,
    DatumParameters,
    DatumParameterKey,
    PayToAddress,
    AddressType, UTxO,
    CSwap
} from '../src';

describe('CSwap', () => {

    const walletProvider: MockWalletProvider = new MockWalletProvider();
    walletProvider.loadWalletFromSeedPhrase(['']);
    const dexter: Dexter = (new Dexter())
        .withDataProvider(new MockDataProvider())
        .withWalletProvider(walletProvider);
    const asset: Asset = new Asset('da8c30857834c6ae7203935b89278c532b3995245295456f993e1d24', '4c51', 6);

    describe('Set Swap In', () => {

        const liquidityPool: LiquidityPool = new LiquidityPool(
            CSwap.identifier,
            'lovelace',
            asset,
            1_000_000_000000n,
            10_000_000n,
            'addr1',
        );
        liquidityPool.poolFeePercent = 0.85;

        const swapRequest: SwapRequest = dexter.newSwapRequest()
            .forLiquidityPool(liquidityPool)
            .withSwapInToken('lovelace')
            .withSwapInAmount(10_000_000n)
            .withSlippagePercent(0.5);

        it('Can calculate swap parameters', () => {
            const cswap = new CSwap();
            const expectedReceive = cswap.estimatedReceive(liquidityPool, 'lovelace', 10_000_000n);
            expect(swapRequest.getEstimatedReceive()).toEqual(expectedReceive);
            const expectedMin = BigInt(Math.floor(Number(expectedReceive) / 1.005));
            expect(swapRequest.getMinimumReceive()).toEqual(expectedMin);
        });

        it('Can build swap order', async () => {
            const cswap: CSwap = new CSwap();
            const defaultSwapParameters: DatumParameters = {
                [DatumParameterKey.SenderPubKeyHash]: walletProvider.publicKeyHash(),
                [DatumParameterKey.SenderStakingKeyHash]: walletProvider.stakingKeyHash(),
                [DatumParameterKey.ReceiverPubKeyHash]: walletProvider.publicKeyHash(),
                [DatumParameterKey.ReceiverStakingKeyHash]: walletProvider.stakingKeyHash(),
                [DatumParameterKey.SwapInAmount]: swapRequest.swapInAmount,
                [DatumParameterKey.MinReceive]: swapRequest.getMinimumReceive(),
                [DatumParameterKey.SwapInTokenPolicyId]: '',
                [DatumParameterKey.SwapInTokenAssetName]: '',
                [DatumParameterKey.SwapOutTokenPolicyId]: asset.policyId,
                [DatumParameterKey.SwapOutTokenAssetName]: asset.nameHex,
            };

            const payments: PayToAddress[] = await cswap.buildSwapOrder(liquidityPool, defaultSwapParameters);
            expect(payments[0].addressType).toBe(AddressType.Contract);
            // deposit + batcher + swap-in ADA
            expect(payments[0].assetBalances.find(a => a.asset === 'lovelace')?.quantity).toEqual(2_000_000n + 690_000n + 10_000_000n);
            expect(typeof payments[0].datum).toBe('string');
            expect(payments[0].isInlineDatum).toBe(true);
        });
    });

    describe('CSwap Cancel Order', () => {
        let cswap: CSwap;
        const returnAddress = 'addr1';
        beforeEach(() => {
            cswap = new CSwap();
        });

        it('should successfully cancel an order', async () => {
            let marketOrderAddress = cswap.orderAddress;
            const txOutputs: UTxO[] = [
                {
                    txHash: 'mockTxHash123',
                    address: marketOrderAddress,
                    datumHash: 'mockDatumHash123',
                    outputIndex: 0,
                    assetBalances: [{ asset: 'lovelace', quantity: 1000000n }]
                }
            ];

            const result = await cswap.buildCancelSwapOrder(txOutputs, returnAddress);

            expect(result).toBeDefined();
            expect(result[0].address).toBe(returnAddress);
            const spend = result[0].spendUtxos?.[0];
            expect(spend?.validator?.type).toBe('PlutusV3');
            expect(spend?.redeemer).toBe('d87a80');
        });

        it('should fail to cancel an order with invalid UTxO', async () => {
            const invalidTxOutputs: UTxO[] = [
                {
                    txHash: 'invalidTxHash',
                    address: 'invalidAddress',
                    datumHash: 'invalidDatumHash',
                    outputIndex: 0,
                    assetBalances: [{ asset: 'lovelace', quantity: 1000000n }]
                }
            ];
            try {
                await cswap.buildCancelSwapOrder(invalidTxOutputs, returnAddress);
                fail('Expected buildCancelSwapOrder to throw an error');
            } catch (error: unknown) {
                if (error instanceof Error) {
                    expect(error.message).toContain('Unable to find relevant UTxO for cancelling the swap order.');
                }
            }
        });
    });
});


