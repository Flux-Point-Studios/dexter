import { Dexter, SaturnSwapAMM, LucidProvider } from '../build/index.js';

async function main() {
  const blockfrostProjectId = process.env.BLOCKFROST_PROJECT_ID;
  const seedPhrase = process.env.SEED_PHRASE;
  const swapInLovelace = Number(process.env.SWAP_IN_LOVELACE || '5000000'); // default 5 ADA
  const slippageBps = Number(process.env.SLIPPAGE_BPS || '50'); // 50 bps
  const partnerAddress = process.env.PARTNER_ADDRESS || 'addr1q9jzvg6qqefx4c8eqsez4fnsxfdmcjtz4ku9f0fgju6ymc7ehhk8tdd2j0fqtn7975krepy8a7l8cepk5gyzyq7g6l6sktytnt';

  if (!blockfrostProjectId) {
    console.error('BLOCKFROST_PROJECT_ID is required');
    process.exit(1);
  }
  if (!seedPhrase) {
    console.error('SEED_PHRASE is required');
    process.exit(1);
  }

  console.log('[SUBMIT][Saturn-AMM][Partner] Initializing wallet (Blockfrost mainnet)...');
  const wallet = new LucidProvider();
  await wallet.loadWalletFromSeedPhrase(
    seedPhrase.trim().split(/\s+/g),
    { accountIndex: 0 },
    { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: blockfrostProjectId }
  );
  const changeAddress = wallet.address();
  console.log('[SUBMIT][Saturn-AMM][Partner] Change address:', changeAddress);

  const dexter = new Dexter({ enableSaturnClob: false }, { timeout: 25000 });
  dexter.withWalletProvider(wallet);
  const amm = dexter.dexByName(SaturnSwapAMM.identifier);
  if (!amm) {
    console.error('SaturnSwap-AMM provider not available');
    process.exit(1);
  }

  console.log('[SUBMIT][Saturn-AMM][Partner] Fetching pools...');
  const pools = await amm.liquidityPools();
  console.log('[SUBMIT][Saturn-AMM][Partner] Pools:', pools.length);
  if (pools.length === 0) {
    console.error('No AMM pools returned');
    process.exit(2);
  }

  // Prefer pools where ADA is the input token for direction=in (ADA -> token)
  const pool = pools.find(p => p.assetA === 'lovelace' || p.assetB === 'lovelace') || pools[0];
  console.log('[SUBMIT][Saturn-AMM][Partner] Selected poolId:', pool.identifier);

  // Build with partner split via underlying axios instance to capture correlation id
  const satApi = amm.api;
  const body = {
    poolId: pool.identifier,
    direction: 'in',
    swapInAmount: swapInLovelace,
    slippageBps,
    changeAddress,
    partnerAddress
  };
  console.log('[SUBMIT][Saturn-AMM][Partner] Building order via REST (with partner)...');
  const res = await satApi.api.post('/v1/aggregator/amm/build-order', body);
  const corr = res.headers?.['x-correlation-id'] || 'n/a';
  const unsignedHex = res.data?.unsignedCborHex;
  if (!unsignedHex) {
    console.error('[SUBMIT][Saturn-AMM][Partner] No unsignedCborHex returned. x-correlation-id:', corr);
    console.error('[SUBMIT][Saturn-AMM][Partner] Response keys:', Object.keys(res.data || {}));
    process.exit(3);
  }
  console.log('[SUBMIT][Saturn-AMM][Partner] Build OK. x-correlation-id:', corr);
  console.log('[SUBMIT][Saturn-AMM][Partner] Unsigned CBOR length:', unsignedHex.length);

  console.log('[SUBMIT][Saturn-AMM][Partner] Importing, signing and submitting...');
  const tx = wallet.newTransactionFromHex(unsignedHex);
  await tx.sign();
  await tx.submit();
  console.log('[SUBMIT][Saturn-AMM][Partner] Submitted tx hash:', tx.hash);
}

main().catch(e => {
  const errMsg = e?.response?.data?.error || e?.message || JSON.stringify(e?.response?.data || {});
  const corr = e?.response?.headers?.['x-correlation-id'] || 'n/a';
  console.error('[SUBMIT][Saturn-AMM][Partner] Failed:', errMsg, 'x-correlation-id:', corr);
  process.exit(1);
});


