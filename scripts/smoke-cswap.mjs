import { Dexter, CSwap, BlockfrostProvider, LucidProvider } from '../build/index.js';

async function main() {
  const { BLOCKFROST_PROJECT_ID, SEED_PHRASE, SLIPPAGE_BPS } = process.env;
  const slippageBps = Number(SLIPPAGE_BPS ?? '50');
  if (!BLOCKFROST_PROJECT_ID) {
    console.error('BLOCKFROST_PROJECT_ID is required');
    process.exit(1);
  }
  if (!SEED_PHRASE) {
    console.error('SEED_PHRASE is required');
    process.exit(1);
  }

  console.log('[SMOKE][CSWAP] Initializing wallet (Blockfrost mainnet)...');
  const wallet = new LucidProvider();
  await wallet.loadWalletFromSeedPhrase(
    SEED_PHRASE.trim().split(/\s+/g),
    { accountIndex: 0 },
    { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: BLOCKFROST_PROJECT_ID }
  );
  const changeAddress = wallet.address();
  console.log('[SMOKE][CSWAP] Change address:', changeAddress);

  const dexter = new Dexter({}, { timeout: 25000 });
  dexter.withWalletProvider(wallet);

  const dataProvider = new BlockfrostProvider(
    { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: BLOCKFROST_PROJECT_ID },
    { timeout: 25000 }
  );
  dexter.withDataProvider(dataProvider);

  const cswap = dexter.dexByName(CSwap.identifier);
  if (!cswap) {
    console.error('CSwap provider not available');
    process.exit(1);
  }

  console.log('[SMOKE][CSWAP] Fetching pools (on-chain by address)...');
  const pools = await cswap.liquidityPools(dataProvider);
  console.log('[SMOKE][CSWAP] Pools:', pools.length);
  if (pools.length === 0) {
    console.error('No CSWAP pools returned');
    process.exit(2);
  }

  const pool = pools.find(p => p.assetA === 'lovelace') || pools[0];
  console.log('[SMOKE][CSWAP] Selected poolId:', pool.identifier);

  // Prepare a small ADA swap-in
  const swapInLovelace = 2_000_000; // 2 ADA
  const swap = dexter.newSwapRequest()
    .forLiquidityPool(pool)
    .withSwapInToken('lovelace')
    .withSwapInAmount(BigInt(swapInLovelace))
    .withSlippagePercent(slippageBps / 100);

  const payTo = await swap.getPaymentsToAddresses();
  const safeJson = (obj) => JSON.stringify(obj, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2);
  console.log('[SMOKE][CSWAP] Built payments:', safeJson(payTo));

  // Build unsigned transaction (no submit)
  const tx = dexter.walletProvider.createTransaction();
  await tx.payToAddresses(payTo);
  console.log('[SMOKE][CSWAP] Built signable transaction (not signing/submitting).');
}

main().catch((e) => {
  console.error('[SMOKE][CSWAP] Error:', e);
  process.exit(1);
});


