import { Dexter, SaturnSwapAMM, LucidProvider } from '../build/index.js';

async function main() {
  const blockfrostProjectId = process.env.BLOCKFROST_PROJECT_ID;
  const seedPhrase = process.env.SEED_PHRASE;
  const swapInLovelace = Number(process.env.SWAP_IN_LOVELACE || '5000000'); // default 5 ADA
  const slippageBps = Number(process.env.SLIPPAGE_BPS || '50'); // 50 bps

  if (!blockfrostProjectId) {
    console.error('BLOCKFROST_PROJECT_ID is required');
    process.exit(1);
  }
  if (!seedPhrase) {
    console.error('SEED_PHRASE is required');
    process.exit(1);
  }

  console.log('[SUBMIT][Saturn-AMM] Initializing wallet (Blockfrost mainnet)...');
  const wallet = new LucidProvider();
  await wallet.loadWalletFromSeedPhrase(
    seedPhrase.trim().split(/\s+/g),
    { accountIndex: 0 },
    { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: blockfrostProjectId }
  );
  const changeAddress = wallet.address();
  console.log('[SUBMIT][Saturn-AMM] Change address:', changeAddress);

  const dexter = new Dexter({ enableSaturnClob: false }, { timeout: 25000 });
  dexter.withWalletProvider(wallet);
  const amm = dexter.dexByName(SaturnSwapAMM.identifier);
  if (!amm) {
    console.error('SaturnSwap-AMM provider not available');
    process.exit(1);
  }

  console.log('[SUBMIT][Saturn-AMM] Fetching pools...');
  const pools = await amm.liquidityPools();
  console.log('[SUBMIT][Saturn-AMM] Pools:', pools.length);
  if (pools.length === 0) {
    console.error('No AMM pools returned');
    process.exit(2);
  }

  // Prefer pools where ADA is the input token for direction=in (ADA -> token)
  const pool = pools.find(p => p.assetA === 'lovelace' || p.assetB === 'lovelace') || pools[0];
  console.log('[SUBMIT][Saturn-AMM] Selected poolId:', pool.identifier);

  console.log('[SUBMIT][Saturn-AMM] Building, signing, and submitting...');
  const txHash = await amm.buildAmmSignSubmit(
    { poolId: pool.identifier, direction: 'in', swapAmount: swapInLovelace, changeAddress, slippageBps },
    wallet
  );
  console.log('[SUBMIT][Saturn-AMM] Submitted tx hash:', txHash);
}

main().catch(e => {
  const errMsg = e?.response?.data?.error || e?.message || String(e);
  console.error('[SUBMIT][Saturn-AMM] Failed:', errMsg);
  process.exit(1);
});


