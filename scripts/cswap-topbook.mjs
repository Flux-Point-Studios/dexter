import { Dexter, CSwap, BlockfrostProvider, getAmmImpliedPrice, getOrderbookTopOfBook, Asset } from '../build/index.js';

async function main() {
  const { BLOCKFROST_PROJECT_ID, TOKEN_UNIT } = process.env;
  if (!BLOCKFROST_PROJECT_ID) {
    console.error('BLOCKFROST_PROJECT_ID is required');
    process.exit(1);
  }
  if (!TOKEN_UNIT) {
    console.error('TOKEN_UNIT (policyId+assetName, empty for ADA) is required');
    process.exit(1);
  }

  const dexter = new Dexter({}, { timeout: 25000 });
  const data = new BlockfrostProvider(
    { url: 'https://cardano-mainnet.blockfrost.io/api/v0', projectId: BLOCKFROST_PROJECT_ID },
    { timeout: 25000 }
  );
  dexter.withDataProvider(data);

  const cswap = dexter.dexByName(CSwap.identifier);
  if (!cswap) {
    console.error('CSwap provider not available');
    process.exit(1);
  }

  // AMM implied (from pool reserves)
  const pools = await cswap.liquidityPools(data);
  const token = TOKEN_UNIT ? Asset.fromIdentifier(TOKEN_UNIT) : undefined;
  const pool = pools.find(p =>
    p.assetA === 'lovelace' &&
    (token ? (p.assetB !== 'lovelace' && p.assetB.policyId === token.policyId && p.assetB.nameHex === token.nameHex) : true)
  ) || pools[0];
  const amm = getAmmImpliedPrice(pool);
  console.log('[TOPBOOK] AMM implied:', amm);

  // Orderbook top-of-book
  if (token) {
    const top = await getOrderbookTopOfBook(data, token.identifier());
    console.log('[TOPBOOK] Orderbook:', top);
  } else {
    console.log('[TOPBOOK] Skipping orderbook scan for ADA.');
  }

  console.log('Note: This is the AMM pool’s implied price. Orderbook best bid/ask could differ; we can extend to read order UTxOs at the orderbook address to synthesize a live spread if needed.');
}

main().catch((e) => {
  console.error('[TOPBOOK] Error:', e && e.response ? e.response.data || e.response.statusText : e);
  process.exit(1);
});


