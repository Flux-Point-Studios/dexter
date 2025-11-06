const axios = require('axios');

(async () => {
  try {
    const base = (process.env.SATURN_API_BASE_URL || 'https://api.saturnswap.io').replace(/\/$/, '');
    const key = process.env.SATURN_API_KEY || '';
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = key.startsWith('Bearer ') ? key : `Bearer ${key}`;

    const api = axios.create({ baseURL: base, headers, timeout: 20000 });

    // 1) Assets
    const assetsResp = await api.get('/v1/aggregator/assets');
    const assets = (assetsResp.data && assetsResp.data.assets) ? assetsResp.data.assets : [];
    console.log('Assets count:', assets.length);
    if (assets.length === 0) {
      console.log('No assets returned. Exiting.');
      process.exit(0);
    }

    // Prefer an asset that has policyId + assetName + poolId
    let chosen = assets.find(a => a && a.policyId !== undefined && a.assetName !== undefined && a.poolId);
    if (!chosen) chosen = assets[0];
    console.log('Chosen asset:', { policyId: chosen.policyId, assetName: chosen.assetName, poolId: chosen.poolId });

    // 2) Orderbook
    const ORDER_ADDR = 'addr1q80ukhmvgtm498e3h6pwpe52whpdh98yy4qfwup5zqg7lqz75jq4yvpskgayj55xegdp30g5rfynax66r8vgn9fldndskl33sd';
    const assetParam = (chosen.policyId ? chosen.policyId : '') + (chosen.assetName ? ('.' + chosen.assetName) : '');
    const obResp = await api.get('/v1/aggregator/orderbook', { params: { asset: assetParam, address: ORDER_ADDR } });
    const asks = obResp.data && obResp.data.asks ? obResp.data.asks.length : 0;
    const bids = obResp.data && obResp.data.bids ? obResp.data.bids.length : 0;
    console.log('Orderbook asks:', asks, 'bids:', bids);

    // 3) Create-order transaction (hex)
    const paymentAddress = process.env.PAYMENT_ADDRESS || ORDER_ADDR; // for smoke only
    const sell = Number(process.env.SELL_AMOUNT || '2000000');
    const buy = Number(process.env.BUY_AMOUNT || '1000000');
    const poolId = process.env.SATURN_POOL_ID || chosen.poolId || '';

    const createBody = {
      paymentAddress,
      limitOrderComponents: [
        {
          poolId,
          tokenAmountSell: sell,
          tokenAmountBuy: buy,
          limitOrderType: 0,
          version: 1,
        }
      ]
    };

    const createResp = await api.post('/v1/aggregator/simple/create-order-transaction', createBody);
    const payload = createResp.data || {};
    const txHex = payload.successTransactions && payload.successTransactions[0] && payload.successTransactions[0].hexTransaction;
    if (!txHex) {
      console.log('No hexTransaction returned. Payload:');
      console.log(JSON.stringify(payload, null, 2));
      process.exit(2);
    }

    console.log('CBOR hex length:', txHex.length);
    console.log('CBOR hex preview:', txHex.slice(0, 96) + '...');
    process.exit(0);
  } catch (e) {
    console.error('Smoke failed:', e.response ? (e.response.data || e.response.statusText) : e.message);
    process.exit(1);
  }
})();
