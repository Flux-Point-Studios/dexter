import { Dexter, SaturnSwapAMM, LucidProvider } from '../build/index.js';

function parseArgs(argv) {
  const args = { submit: false, direction: 'in', slippageBps: 50 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--submit') args.submit = true;
    else if (a === '--amount' && argv[i + 1]) { args.amountAda = Number(argv[++i]); }
    else if (a === '--amount-lovelace' && argv[i + 1]) { args.amountLovelace = Number(argv[++i]); }
    else if (a === '--partner' && argv[i + 1]) { args.partnerAddress = argv[++i]; }
    else if (a === '--pool-id' && argv[i + 1]) { args.poolId = argv[++i]; }
    else if (a === '--slippage-bps' && argv[i + 1]) { args.slippageBps = Number(argv[++i]); }
    else if (a === '--direction' && argv[i + 1]) { args.direction = argv[++i]; }
  }
  return args;
}

async function main() {
  const {
    BLOCKFROST_PROJECT_ID,
    SEED_PHRASE,
    SWAP_IN_LOVELACE,
    PARTNER_ADDRESS,
  } = process.env;

  const cli = parseArgs(process.argv);
  const blockfrostProjectId = BLOCKFROST_PROJECT_ID;
  const seedPhrase = SEED_PHRASE;
  const direction = cli.direction || 'in';
  const slippageBps = Number(cli.slippageBps ?? 50);
  const partnerAddress = cli.partnerAddress || PARTNER_ADDRESS || '';

  if (!blockfrostProjectId) throw new Error('BLOCKFROST_PROJECT_ID is required');
  if (!seedPhrase) throw new Error('SEED_PHRASE is required');

  const amountLovelace = Number(
    cli.amountLovelace ??
    (cli.amountAda !== undefined ? Math.round(cli.amountAda * 1_000_000) : undefined) ??
    SWAP_IN_LOVELACE ??
    2_000_000
  );

  console.log(JSON.stringify({ step: 'init', direction, slippageBps, amountLovelace, partner: !!partnerAddress }));

  const wallet = new LucidProvider();
  await wallet.loadWalletFromSeedPhrase(
    seedPhrase.trim().split(/\s+/g),
    { accountIndex: 0 },
    { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: blockfrostProjectId }
  );
  const changeAddress = wallet.address();
  console.log(JSON.stringify({ step: 'wallet_ready', changeAddress }));

  const dexter = new Dexter({ enableSaturnClob: false }, { timeout: 25000 });
  dexter.withWalletProvider(wallet);
  const amm = dexter.dexByName(SaturnSwapAMM.identifier);
  if (!amm) throw new Error('SaturnSwap-AMM provider not available');

  let poolId = cli.poolId;
  if (!poolId) {
    const pools = await amm.liquidityPools();
    console.log(JSON.stringify({ step: 'pools_fetched', count: pools.length }));
    if (pools.length === 0) throw new Error('No AMM pools');
    const pool = pools.find(p => p.assetA === 'lovelace' || p.assetB === 'lovelace') || pools[0];
    poolId = pool.identifier;
  }
  console.log(JSON.stringify({ step: 'pool_selected', poolId }));

  // Use REST directly to pass partnerAddress when present
  const satApi = amm.api;
  const body = direction === 'in'
    ? { poolId, direction, swapInAmount: amountLovelace, slippageBps, changeAddress }
    : { poolId, direction, swapOutAmount: amountLovelace, slippageBps, changeAddress };
  if (partnerAddress) body.partnerAddress = partnerAddress;

  const res = await satApi.api.post('/v1/aggregator/amm/build-order', body);
  const corr = res.headers?.['x-correlation-id'] || 'n/a';
  const unsignedHex = res.data?.unsignedCborHex;
  if (!unsignedHex) {
    console.log(JSON.stringify({ step: 'build_failed', correlationId: corr, keys: Object.keys(res.data || {}) }));
    process.exit(3);
  }
  console.log(JSON.stringify({ step: 'build_ok', correlationId: corr, unsignedLen: unsignedHex.length }));

  const tx = wallet.newTransactionFromHex(unsignedHex);
  if (!cli.submit) {
    await tx.sign();
    const cbor = tx.toCbor();
    console.log(JSON.stringify({ step: 'signed_ok', signedLen: cbor.length }));
    return;
  }

  await tx.sign();
  await tx.submit();
  console.log(JSON.stringify({ step: 'submitted', txHash: tx.hash }));
}

main().catch(e => {
  const errMsg = e?.response?.data?.error || e?.message || String(e);
  const corr = e?.response?.headers?.['x-correlation-id'] || 'n/a';
  console.error(JSON.stringify({ step: 'error', error: errMsg, correlationId: corr }));
  process.exit(1);
});


