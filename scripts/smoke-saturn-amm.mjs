import { Dexter, SaturnSwapAMM, LucidProvider } from '../build/index.js';

async function main() {
  const blockfrostProjectId = process.env.BLOCKFROST_PROJECT_ID;
  const seedPhrase = process.env.SEED_PHRASE;
  const swapInLovelace = Number(process.env.SWAP_IN_LOVELACE || '2000000'); // 2 ADA
  const slippageBps = Number(process.env.SLIPPAGE_BPS || '50'); // 50 bps

  if (!blockfrostProjectId) {
    console.error('BLOCKFROST_PROJECT_ID is required');
    process.exit(1);
  }
  if (!seedPhrase) {
    console.error('SEED_PHRASE is required');
    process.exit(1);
  }

  console.log('[SMOKE][Saturn-AMM] Initializing wallet (Blockfrost mainnet)...');
  const wallet = new LucidProvider();
  await wallet.loadWalletFromSeedPhrase(
    seedPhrase.trim().split(/\s+/g),
    { accountIndex: 0 },
    { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: blockfrostProjectId }
  );
  const changeAddress = wallet.address();
  console.log('[SMOKE][Saturn-AMM] Change address:', changeAddress);

  const dexter = new Dexter({ enableSaturnClob: false }, { timeout: 25000 });
  dexter.withWalletProvider(wallet);
  const amm = dexter.dexByName(SaturnSwapAMM.identifier);
  if (!amm) {
    console.error('SaturnSwap-AMM provider not available');
    process.exit(1);
  }

  console.log('[SMOKE][Saturn-AMM] Fetching pools...');
  const pools = await amm.liquidityPools();
  console.log('[SMOKE][Saturn-AMM] Pools:', pools.length);
  if (pools.length === 0) {
    console.error('No AMM pools returned');
    process.exit(2);
  }

  // Prefer pools where ADA is the input token for direction=in (ADA -> token)
  const pool = pools.find(p => p.assetA === 'lovelace' || p.assetB === 'lovelace') || pools[0];
  console.log('[SMOKE][Saturn-AMM] Selected poolId:', pool.identifier);
  console.log('[SMOKE][Saturn-AMM] Building unsigned hex via ammBuildOrder...');

  const unsignedHex = await amm.createAmmUnsignedHex(
    pool.identifier,
    'in',
    swapInLovelace,
    changeAddress,
    slippageBps
  );
  console.log('[SMOKE][Saturn-AMM] Unsigned CBOR hex length:', unsignedHex.length);

  console.log('[SMOKE][Saturn-AMM] Importing, signing (no submit) ...');
  const tx = wallet.newTransactionFromHex(unsignedHex);
  await tx.sign(); // signed builder
  const cbor = tx.toCbor(); // robust serializer (toCBOR/toHex fallback)
  console.log('[SMOKE][Saturn-AMM] Signed CBOR length:', cbor.length);
  console.log('[SMOKE][Saturn-AMM] OK (not submitted)');
}

main().catch(e => {
  console.error('[SMOKE][Saturn-AMM] Failed:', e?.response?.data?.error || e?.message || String(e));
  process.exit(1);
});


