const axios = require('axios');

(async () => {
  try {
    const base = (process.env.SATURN_API_BASE_URL || 'https://api.saturnswap.io').replace(/\/$/, '');
    const key = process.env.SATURN_API_KEY || '';
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = key.startsWith('Bearer ') ? key : `Bearer ${key}`;

    const api = axios.create({ baseURL: base, headers, timeout: 25000 });

    const asset = process.env.SATURN_ASSET || '83f22ab6467de8ed6754f9851d7a92a2377071cf94d101d87ca2dbe65045534f';
    const direction = Number(process.env.SATURN_DIRECTION || '3'); // 3 = MarketBuy ADA->token
    const tokenAmountSell = Number(process.env.SATURN_SELL || '0.5');
    const tokenAmountBuy = Number(process.env.SATURN_BUY || '0');
    const slippage = null; // As advised when tokenAmountBuy=0
    const paymentAddress = process.env.PAYMENT_ADDRESS || '';

    if (!paymentAddress) {
      console.error('PAYMENT_ADDRESS is required');
      process.exit(1);
    }

    // 1) Quote (no auth required)
    const quoteBody = { asset, direction, tokenAmountSell, tokenAmountBuy, slippage };
    const quoteResp = await api.post('/v1/aggregator/quote', quoteBody);
    console.log('Quote response:', JSON.stringify(quoteResp.data, null, 2));

    // 2) Build (create-from-asset) - requires API key & funded address
    const buildBody = { asset, direction, tokenAmountSell, tokenAmountBuy, slippage, paymentAddress };
    const buildResp = await api.post('/v1/aggregator/simple/create-from-asset', buildBody);
    const payload = buildResp.data || {};
    console.log('Create-from-asset payload keys:', Object.keys(payload));

    const hex = payload && payload.successTransactions && payload.successTransactions[0] && payload.successTransactions[0].hexTransaction;
    if (!hex) {
      console.log('No hexTransaction returned. Full payload:');
      console.log(JSON.stringify(payload, null, 2));
      process.exit(2);
    }

    console.log('CBOR hex length:', hex.length);
    console.log('CBOR hex preview:', hex.slice(0, 120) + '...');
    process.exit(0);
  } catch (e) {
    const msg = e && e.response && (e.response.data || e.response.statusText) ? (typeof e.response.data === 'object' ? JSON.stringify(e.response.data) : e.response.statusText) : (e && e.message ? e.message : String(e));
    console.error('Run failed:', msg);
    process.exit(1);
  }
})();
