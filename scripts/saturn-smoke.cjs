const axios = require('axios');

(async () => {
  try {
    const base = (process.env.SATURN_API_BASE_URL || 'https://api.saturnswap.io').replace(/\/$/, '');
    const key = process.env.SATURN_API_KEY || '';
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = key.startsWith('Bearer ') ? key : `Bearer ${key}`;

    const api = axios.create({ baseURL: base, headers, timeout: 25000 });

    // Helper: per-pool depth via GraphQL
    async function poolDepth(poolId) {
      const query = `query($poolId: UUID!) {\n        poolUtxos(\n          where: {\n            pool: { id: { eq: $poolId } }\n            dbsync_spent_checked_timestamp: { isNull: true }\n            active_type: { in: [LimitSellOrder, LimitBuyOrder] }\n            active_status: { in: [Pending, Complete] }\n            spend_status: { in: [None, Cancelled, Failed, Expired] }\n          }\n          order: { price: ASC }\n          first: 50\n        ) { items { active_type } totalCount }\n      }`;
      try {
        const { data } = await api.post('/v1/graphql', { query, variables: { poolId } });
        const res = data && data.data && data.data.poolUtxos ? data.data.poolUtxos : { items: [], totalCount: 0 };
        const items = res.items || [];
        const counts = items.reduce((acc, it) => { acc[it.active_type] = (acc[it.active_type] || 0) + 1; return acc; }, {});
        return { total: res.totalCount || 0, sell: counts['LimitSellOrder'] || 0, buy: counts['LimitBuyOrder'] || 0 };
      } catch (e) {
        return { total: 0, sell: 0, buy: 0, err: true };
      }
    }

    // 1) Assets (list of { poolId, policyId, assetName })
    const assetsResp = await api.get('/v1/aggregator/assets');
    const assets = (assetsResp.data && assetsResp.data.assets) ? assetsResp.data.assets : [];
    console.log('Assets count:', assets.length);
    if (assets.length === 0) { console.log('No assets'); process.exit(0); }

    const paymentAddress = process.env.PAYMENT_ADDRESS || 'addr1q80ukhmvgtm498e3h6pwpe52whpdh98yy4qfwup5zqg7lqz75jq4yvpskgayj55xegdp30g5rfynax66r8vgn9fldndskl33sd';

    // Group by token to prefer assets with orderbook depth
    const byToken = new Map();
    for (const a of assets) {
      if (!a) continue;
      const k = `${a.policyId || ''}|${a.assetName || ''}`;
      if (!byToken.has(k)) byToken.set(k, []);
      byToken.get(k).push(a);
    }

    // Iterate tokens: pick those with live orderbook (aggregated) first
    for (const [k, list] of byToken.entries()) {
      const [policyId, assetName] = k.split('|');
      const assetParam = (policyId || '') + (assetName || '');
      let ob; try { ob = await api.get('/v1/aggregator/orderbook', { params: { asset: assetParam } }); } catch { continue; }
      const asksLen = ob.data && ob.data.asks ? ob.data.asks.length : 0;
      const bidsLen = ob.data && ob.data.bids ? ob.data.bids.length : 0;
      if ((asksLen + bidsLen) === 0) continue;

      // For each poolId of this token, check per-pool depth via GraphQL, then build accordingly
      for (const entry of list) {
        const poolId = entry.poolId;
        if (!poolId) continue;
        const depth = await poolDepth(poolId);
        if (depth.err || depth.total === 0) continue;
        console.log(`Pool ${poolId} depth => total=${depth.total} sell=${depth.sell} buy=${depth.buy}`);

        // If there are LimitSell orders => we can MarketBuy ADA->token
        if (depth.sell > 0) {
          const body = {
            paymentAddress,
            marketOrderComponents: [
              { poolId, tokenAmountSell: 0.5, tokenAmountBuy: 0.0, marketOrderType: 3, slippage: null, version: 1 }
            ]
          };
          try {
            const resp = await api.post('/v1/aggregator/simple/create-order-transaction', body);
            const payload = resp.data || {};
            const hex = payload && payload.successTransactions && payload.successTransactions[0] && payload.successTransactions[0].hexTransaction;
            console.log('MarketBuy 0.5 ADA ->', hex ? 'OK' : (payload.error ? payload.error.message : 'No hex'));
            if (hex) { console.log('CBOR hex length:', hex.length); console.log('CBOR hex preview:', hex.slice(0,96)+'...'); process.exit(0); }
          } catch (e) {}
        }

        // If there are LimitBuy orders => we can MarketSell token->ADA
        if (depth.buy > 0) {
          const body = {
            paymentAddress,
            marketOrderComponents: [
              { poolId, tokenAmountSell: 5.0, tokenAmountBuy: 0.0, marketOrderType: 4, slippage: null, version: 1 }
            ]
          };
          try {
            const resp = await api.post('/v1/aggregator/simple/create-order-transaction', body);
            const payload = resp.data || {};
            const hex = payload && payload.successTransactions && payload.successTransactions[0] && payload.successTransactions[0].hexTransaction;
            console.log('MarketSell 5 TOK ->', hex ? 'OK' : (payload.error ? payload.error.message : 'No hex'));
            if (hex) { console.log('CBOR hex length:', hex.length); console.log('CBOR hex preview:', hex.slice(0,96)+'...'); process.exit(0); }
          } catch (e) {}
        }
      }
    }

    console.log('No valid pool with live depth produced a transaction at this time.');
    process.exit(2);
  } catch (e) {
    const msg = e && e.response && (e.response.data || e.response.statusText) ? (typeof e.response.data === 'object' ? JSON.stringify(e.response.data) : e.response.statusText) : (e && e.message ? e.message : String(e));
    console.error('Smoke failed:', msg);
    process.exit(1);
  }
})();
