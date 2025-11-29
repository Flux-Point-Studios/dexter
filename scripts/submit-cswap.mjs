import { Dexter, CSwap, BlockfrostProvider, LucidProvider } from '../build/index.js';

async function main() {
  const { BLOCKFROST_PROJECT_ID, SEED_PHRASE, SLIPPAGE_BPS, SWAP_IN_LOVELACE } = process.env;
  const slippageBps = Number(SLIPPAGE_BPS ?? '50');
  const swapIn = Number(SWAP_IN_LOVELACE ?? '2000000');
  if (!BLOCKFROST_PROJECT_ID) {
    console.error('BLOCKFROST_PROJECT_ID is required');
    process.exit(1);
  }
  if (!SEED_PHRASE) {
    console.error('SEED_PHRASE is required');
    process.exit(1);
  }

  console.log('[SUBMIT][CSWAP] Initializing wallet (Blockfrost mainnet)...');
  const wallet = new LucidProvider();
  await wallet.loadWalletFromSeedPhrase(
    SEED_PHRASE.trim().split(/\s+/g),
    { accountIndex: 0 },
    { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: BLOCKFROST_PROJECT_ID }
  );
  const changeAddress = wallet.address();
  console.log('[SUBMIT][CSWAP] Change address:', changeAddress);

  const dexter = new Dexter({}, { timeout: 25000 });
  dexter.withWalletProvider(wallet);

  const dataProvider = new BlockfrostProvider(
    { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: BLOCKFROST_PROJECT_ID },
    { timeout: 25000 }
  );
  dexter.withDataProvider(dataProvider);

  const cswap = dexter.dexByName(CSwap.identifier);
  if (!cswap) {
    throw new Error('CSwap provider not available');
  }

  console.log('[SUBMIT][CSWAP] Fetching pools (on-chain by address)...');
  const pools = await cswap.liquidityPools(dataProvider);
  console.log('[SUBMIT][CSWAP] Pools:', pools.length);
  if (pools.length === 0) {
    throw new Error('No CSWAP pools returned');
  }

  const pool = pools.find(p => p.assetA === 'lovelace') || pools[0];
  console.log('[SUBMIT][CSWAP] Selected poolId:', pool.identifier);

  const swap = dexter.newSwapRequest()
    .forLiquidityPool(pool)
    .withSwapInToken('lovelace')
    .withSwapInAmount(BigInt(swapIn))
    .withSlippagePercent(slippageBps / 100);

  const payTo = await swap.getPaymentsToAddresses();
  console.log('[SUBMIT][CSWAP] Building, signing, and submitting...');
  const tx = dexter.walletProvider.createTransaction();
  await tx.payToAddresses(payTo);
  await tx.sign();
  await tx.submit();
  console.log('[SUBMIT][CSWAP] Submitted tx hash:', tx.hash);
}

main().catch((e) => {
  console.error('[SUBMIT][CSWAP] Error:', e && e.response ? e.response.data || e.response.statusText : e);
  process.exit(1);
});


