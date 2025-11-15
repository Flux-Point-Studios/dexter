const axios = require('axios');

async function testPoolDetails() {
    const baseUrl = 'https://api.saturnswap.io';
    const timeout = 15000;

    console.log('Testing pool details and buildability...\n');

    try {
        // Get pools
        const poolsRes = await axios.get(`${baseUrl}/v1/aggregator/pools`, { timeout });
        const pools = Array.isArray(poolsRes.data) ? poolsRes.data : (poolsRes.data?.pools || []);
        console.log(`Got ${pools.length} pools\n`);

        // Test first 3 pools for detail and buildability
        for (let i = 0; i < Math.min(3, pools.length); i++) {
            const pool = pools[i];
            console.log(`Pool ${i + 1}: ${pool.id}`);
            console.log(`  assetA: ${pool.assetA}, assetB: ${pool.assetB}`);

            // Get pool detail
            try {
                const detailRes = await axios.get(
                    `${baseUrl}/v1/aggregator/pools/by-pool`,
                    { params: { id: pool.poolId || pool.id }, timeout }
                );
                const detail = detailRes.data;
                console.log(`  ✅ Detail retrieved`);
                console.log(`     id: ${detail.id}`);
                console.log(`     poolId: ${detail.poolId}`);
                console.log(`     buildable.marketBuyFromAda: ${detail.buildable?.marketBuyFromAda}`);
                console.log(`     buildable.marketSellToAda: ${detail.buildable?.marketSellToAda}`);
                console.log(`     bestBid: ${detail.bestBid}`);
                console.log(`     bestAsk: ${detail.bestAsk}`);

                // Try quote if buildable
                if (detail.buildable?.marketBuyFromAda) {
                    console.log(`  Testing quote (marketBuyFromAda)...`);
                    try {
                        const quoteRes = await axios.post(
                            `${baseUrl}/v1/aggregator/amm/quote`,
                            {
                                poolId: detail.poolId || detail.id,
                                direction: 'in',
                                swapInAmount: 1_000_000,
                                slippageBps: 50
                            },
                            { timeout }
                        );
                        console.log(`     ✅ Quote successful: expectedOut=${quoteRes.data?.expectedOut}`);
                    } catch (quoteErr) {
                        console.log(`     ❌ Quote failed: ${quoteErr.response?.status} ${quoteErr.response?.data?.error || quoteErr.message}`);
                    }
                } else {
                    console.log(`  ⚠️  Pool not buildable for marketBuyFromAda`);
                }
            } catch (detailErr) {
                console.log(`  ❌ Detail failed: ${detailErr.response?.status} ${detailErr.response?.data?.error || detailErr.message}`);
            }
            console.log('');
        }

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data: ${JSON.stringify(error.response.data)}`);
        }
        process.exit(1);
    }
}

testPoolDetails().then(() => {
    console.log('✅ Test complete');
    process.exit(0);
}).catch(err => {
    console.error('❌ Test error:', err);
    process.exit(1);
});

